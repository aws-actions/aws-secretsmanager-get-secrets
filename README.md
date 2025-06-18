# Use AWS Secrets Manager secrets in GitHub jobs

To use a secret in a GitHub job, you can use a GitHub action to retrieve secrets from AWS Secrets Manager and add them as masked [Environment variables](https://docs.github.com/en/actions/learn-github-actions/environment-variables) in your GitHub workflow. For more information about GitHub Actions, see [Understanding GitHub Actions](https://docs.github.com/en/actions/learn-github-actions/understanding-github-actions) in the *GitHub Docs*.

When you add a secret to your GitHub environment, it is available to all other steps in your GitHub job. Follow the guidance in [Security hardening for GitHub Actions](https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions) to help prevent secrets in your environment from being misused.

You can set the entire string in the secret value as the environment variable value, or if the string is JSON, you can parse the JSON to set individual environment variables for each JSON key-value pair. If the secret value is a binary, the action converts it to a string.

To view the environment variables created from your secrets, turn on debug logging. For more information, see [Enabling debug logging](https://docs.github.com/en/actions/monitoring-and-troubleshooting-workflows/enabling-debug-logging) in the *GitHub Docs*.

To use the environment variables created from your secrets, see [Environment variables](https://docs.github.com/en/actions/learn-github-actions/environment-variables) in the *GitHub Docs*.

### Prerequisites

To use this action, you first need to configure AWS credentials and set the AWS Region in your GitHub environment by using the `configure-aws-credentials` step. Follow the instructions in [Configure AWS Credentials Action For GitHub Actions](https://github.com/aws-actions/configure-aws-credentials) to **Assume role directly using GitHub OIDC provider**. This allows you to use short-lived credentials and avoid storing additional access keys outside of Secrets Manager.

The IAM role the action assumes must have the following permissions:
+ `GetSecretValue` on the secrets you want to retrieve.
+ `ListSecrets` on all secrets.
+ \(Optional\) `Decrypt` on the KMS key if the secrets are encrypted with a customer managed key.

For more information, see [Authentication and access control for AWS Secrets Manager](https://docs.aws.amazon.com/secretsmanager/latest/userguide/auth-and-access.html).

### Usage

To use the action, add a step to your workflow that uses the following syntax.

```
- name: Step name
  uses: aws-actions/aws-secretsmanager-get-secrets@v2
  with:
    secret-ids: |
      secretId1
      ENV_VAR_NAME, secretId2
    name-transformation: (Optional) uppercase|lowercase|none
    parse-json-secrets: (Optional) true|false
    auto-select-family-attempt-timeout: (Optional) positive integer
```
Parameters

- `secret-ids` Secret ARNS, names, and name prefixes. 

By default, the step creates each environment variable name from the secret name, transformed to include only uppercase letters, numbers, and underscores, and so that it doesn't begin with a number.   

To set the environment variable name, enter it before the secret ID, followed by a comma. For example `ENV_VAR_1, secretId` creates an environment variable named **ENV\_VAR\_1** from the secret `secretId`. 

The environment variable name can consist of uppercase letters, numbers, and underscores. 

To use a prefix, enter at least three characters followed by an asterisk. For example `dev*` matches all secrets with a name beginning in **dev**. The maximum number of matching secrets that can be retrieved is 100. If you set the variable name, and the prefix matches multiple secrets, then the action fails.

- `name-transformation`

By default, the step creates each environment variable name from the secret name, transformed to include only uppercase letters, numbers, and underscores, and so that it doesn't begin with a number. For the letters in the name, you can configure the step to use lowercase letters with `lowercase` or to not change the case of the letters with `none`. The default value is `uppercase`.

- `parse-json-secrets`

(Optional - default false) By default, the action sets the environment variable value to the entire JSON string in the secret value. 

Set `parse-json-secrets` to `true` to create environment variables for each key/value pair in the JSON.

Note that if the JSON uses case-sensitive keys such as "name" and "Name", the action will have duplicate name conflicts. In this case, set `parse-json-secrets` to `false` and parse the JSON secret value separately. 

- `auto-select-family-attempt-timeout`

(Optional - default 1000) Specifies the timeout (in milliseconds) for attempting to connect to the first IP address in a dual-stack DNS lookup. This setting is crucial especially when GitHub Action workers are geographically distant from the target region where the secrets are stored. The timeout must be greater than ot equal to 10 ms

Set `auto-select-family-attempt-timeout` to any positive integer that is greater than or equal to 10 ms to set the timeout between each call to that value in milliseconds. 
### Environment variable naming

The environment variables created by the action are named the same as the secrets they come from. Environment variables have stricter naming requirements than secrets, so the action transforms secret names to meet those requirements. For example, the action transforms lowercase letters to uppercase letters. If you parse the JSON of the secret, then the environment variable name includes both the secret name and the JSON key name, for example `MYSECRET_KEYNAME`.

If two environment variables would end up with the same name, the action fails. In this case, you must specify the names you want to use for the environment variables as *aliases*.

Examples of when the names might conflict:
+ A secret named "MySecret" and a secret named "mysecret" would both become environment variables named "MYSECRET".
+ A secret named "Secret_keyname" and a JSON-parsed secret named "Secret" with a key named "keyname" would both become environment variables named "SECRET_KEYNAME".

You can set the environment variable name by specifying an *alias*, as shown in the following example which creates a variable named `ENV_VAR_NAME`.

```
secret-ids: |
  ENV_VAR_NAME, secretId2
```

**Blank aliases**
+ If you set `parse-json-secrets: true` and enter a blank alias, followed by a comma and then the secret ID, the action names the environment variable the same as the parsed JSON keys. The variable names do not include the secret name. 

  If the secret doesn't contain valid JSON, then the action creates one environment variable and names it the same as the secret name.
+ If you set `parse-json-secrets: false` and enter a blank alias, followed by a comma and the secret ID, the action names the environment variables as if you did not specify an alias.

The following example shows a blank alias.

```
,secret2
```

### Examples

**Example 1 Get secrets by name and by ARN**  
The following example creates environment variables for secrets identified by name and by ARN.  

```
- name: Get secrets by name and by ARN
  uses: aws-actions/aws-secretsmanager-get-secrets@v2
  with:
    secret-ids: |
      exampleSecretName
      arn:aws:secretsmanager:us-east-2:123456789012:secret:test1-a1b2c3
      0/test/secret
      /prod/example/secret
      SECRET_ALIAS_1,test/secret
      SECRET_ALIAS_2,arn:aws:secretsmanager:us-east-2:123456789012:secret:test2-a1b2c3
      ,secret2
```
Environment variables created:  

```
EXAMPLESECRETNAME: secretValue1
TEST1: secretValue2
_0_TEST_SECRET: secretValue3
_PROD_EXAMPLE_SECRET: secretValue4
SECRET_ALIAS_1: secretValue5
SECRET_ALIAS_2: secretValue6
SECRET2: secretValue7
```

**Example 2 Get all secrets that begin with a prefix**  
The following example creates environment variables for all secrets with names that begin with *beta*.  

```
- name: Get Secret Names by Prefix
  uses: aws-actions/aws-secretsmanager-get-secrets@v2
  with:
    secret-ids: |
      beta*    # Retrieves all secrets that start with 'beta'
```
Environment variables created:  

```
BETASECRETNAME: secretValue1
BETATEST: secretValue2
BETA_NEWSECRET: secretValue3
```

**Example 3 Parse JSON in secret**  
The following example creates environment variables by parsing the JSON in the secret.  

```
- name: Get Secrets by Name and by ARN
  uses: aws-actions/aws-secretsmanager-get-secrets@v2
  with:
    secret-ids: |
      test/secret
      ,secret2
    parse-json-secrets: true
```
The secret `test/secret` has the following secret value.  

```
{
  "api_user": "user",
  "api_key": "key",
  "config": {
    "active": "true"
  }
}
```
The secret `secret2` has the following secret value.  

```
{
  "myusername": "alejandro_rosalez",
  "mypassword": "EXAMPLE_PASSWORD"
}
```
Environment variables created:  

```
TEST_SECRET_API_USER: "user"
TEST_SECRET_API_KEY: "key"
TEST_SECRET_CONFIG_ACTIVE: "true"
MYUSERNAME: "alejandro_rosalez"
MYPASSWORD: "EXAMPLE_PASSWORD"
```

**Example 4 Use lowercase letters for environment variable names**
The following example creates an environment variable with a lowercase name.

```
- name: Get secrets
  uses: aws-actions/aws-secretsmanager-get-secrets@v2
  with:
    secret-ids: exampleSecretName
    name-transformation: lowercase
```

Environment variable created:

```
examplesecretname: secretValue
```

**Example 5 Setting the timeout to 2 seconds**
The following example sets the timeout between each call to be 2 seconds

```
- name: Get secrets with custom timeout
  uses: aws-actions/aws-secretsmanager-get-secrets@v2
  with:
    secret-ids: |
      test/secret
      prod/secret
    auto-select-family-attempt-timeout: 2000  # Sets timeout to 2 seconds between calls
```

Environment variables created:

```
TEST_SECRET: secretValue1
PROD_SECRET: secretValue2
```

## Security

See [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications) for more information.

## License

This library is licensed under the MIT-0 License. See the LICENSE file.
