# Use AWS Secrets Manager secrets in GitHub jobs
​
To use a secret in a GitHub job, you can use a GitHub action to retrieve secrets from AWS Secrets Manager and add them as masked [Environment variables](https://docs.github.com/en/actions/learn-github-actions/environment-variables) in your GitHub workflow. For more information about GitHub Actions, see [Understanding GitHub Actions](https://docs.github.com/en/actions/learn-github-actions/understanding-github-actions) in the *GitHub Docs*.
​

When you add a secret to your GitHub environment, it is available to all other steps in your GitHub job. Follow the guidance in [Security hardening for GitHub Actions](https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions) to help prevent secrets in your environment from being misused.
​

Environment variables have stricter naming requirements than secrets, so this action transforms secret names to meet those requirements. For example, the action transforms lowercase letters to uppercase letters. Because of the transformed names, two environment variables might end up with the same name. For example, a secret named "MySecret" and a secret named "mysecret" would both become environment variables named "MYSECRET". In this case, the action will fail, because environment variable names must be unique. Instead, you must specify the name you want to use for the environment variable.
​

You can set the entire string in the secret value as the environment variable value, or if the string is JSON, you can parse the JSON to set individual environment variables for each JSON key-value pair. If the secret value is a binary, the action converts it to a string.
​

To view the environment variables created from your secrets, turn on debug logging. For more information, see [Enabling debug logging](https://docs.github.com/en/actions/monitoring-and-troubleshooting-workflows/enabling-debug-logging) in the *GitHub Docs*.
​
​
### Prerequisites
​
To use this action, you first need to configure AWS credentials and set the AWS Region in your GitHub environment by using the `configure-aws-credentials` step. Follow the instructions in [Configure AWS Credentials Action For GitHub Actions](https://github.com/aws-actions/configure-aws-credentials) to **Assume role directly using GitHub OIDC provider**. This allows you to use short-lived credentials and avoid storing additional access keys outside of Secrets Manager.
​
The IAM role the action assumes must have the following permissions:
+ `GetSecretValue` on the secrets you want to retrieve
+ `ListSecrets` on all secrets
+ (Optional) `Decrypt` on the KMS key if the secrets are encrypted with a customer managed key.
​
For more information, see [Authentication and access control for AWS Secrets Manager](https://docs.aws.amazon.com/secretsmanager/latest/userguide/auth-and-access.html).
​
### Usage
​
To use the action, add a step to your workflow that uses the following syntax.
​
```
- name: Step name
  uses: aws-actions/aws-secretsmanager-get-secrets@v1
  with:
    secret-ids: |
      secretId1
      ENV_VAR, secretId2
    parse-json-secrets: (Optional) true|false
```

### Parameters
- `secret-ids`: Secret ARNS, names, and name prefixes. 

By default, the step creates each environment variable name from the secret name, transformed to include only uppercase letters, numbers, and underscores, and so that it doesn't begin with a number. 

To set the environment variable name, enter it before the secret ID, followed by a comma. For example `ENV_VAR_1, secretId` creates an environment variable named **ENV_VAR_1** from the secret `secretId`. 

The environment variable name can consist of uppercase letters, numbers, and underscores.  

To use a prefix, enter at least three characters followed by an asterisk. For example `dev*` matches all secrets with a name beginning in **dev**. The maximum number of matching secrets that can be retrieved is 100. If you set the variable name, and the prefix matches multiple secrets, then the action fails.
​
- `parse-json-secrets`

(Optional - default false) By default, the action sets the environment variable value to the entire JSON string in the secret value. 

Set `parse-json-secrets` to `true` to create environment variables for each key/value pair in the JSON.

Note that if the JSON uses case-sensitive keys such as "name" and "Name", the action will have duplicate name conflicts. In this case, set `parse-json-secrets` to `false` and parse the JSON secret value separately. 
​
### Examples
​
**Example 1: Get secrets by name and by ARN**  
The following example creates environment variables for secrets identified by name and by ARN.  
​
```
- name: Get secrets by name and by ARN
  uses: aws-actions/aws-secretsmanager-get-secrets@v1
  with:
    secret-ids: |
      exampleSecretName
      arn:aws:secretsmanager:us-east-2:123456789012:secret:test1-a1b2c3
      0/test/secret
      /prod/example/secret
      SECRET_ALIAS_1,test/secret
      SECRET_ALIAS_2,arn:aws:secretsmanager:us-east-2:123456789012:secret:test2-a1b2c3
```


Environment variables created:  
​
```
EXAMPLESECRETNAME: secretValue1
TEST1: secretValue2
_0_TEST_SECRET: secretValue3
_PROD_EXAMPLE_SECRET: secretValue4
SECRET_ALIAS_1: secretValue5
SECRET_ALIAS_2: secretValue6
```
​
**Example 2: Get all secrets that begin with a prefix**  
The following example creates environment variables for all secrets with names that begin with *beta*.  
​
```
- name: Get Secret Names by Prefix
  uses: aws-actions/aws-secretsmanager-get-secrets@v1
  with:
    secret-ids: |
      beta*    # Retrieves all secrets that start with 'beta'
```
Assuming the search for `beta` produces 3 results (`betaSecretName`, `betaTest` and `beta/NewSecret`, environment variables created:  
​
```
BETASECRETNAME: secretValue1
BETATEST: secretValue2
BETA_NEWSECRET: secretValue3
```
​
**Example 3: Parse JSON in secret**  
The following example creates environment variables by parsing the JSON in the secret.  
​
```
- name: Get Secrets by Name and by ARN
  uses: aws-actions/aws-secretsmanager-get-secrets@v1
  with:
    secret-ids: |
      test/secret
    parse-json-secrets: true
```
The secret `test/secret` has the following secret value.  
​
```
{
  "api_user": "user",
  "api_key": "key",
  "config": {
    "active": "true"
  }
}
```
Environment variables created:  
​
```
TEST_SECRET_API_USER: "user"
TEST_SECRET_API_KEY: "key"
TEST_SECRET_CONFIG_ACTIVE: "true"
```


**Example 4: Parsed JSON in secret with custom prefix**

The following example creates environment variables by parsing the JSON in the secret and prefixes them based on provided prefix.
​
```
- name: Get Secrets by Name and by ARN
  uses: aws-actions/aws-secretsmanager-get-secrets@v1
  with:
    secret-ids: |
      CUSTOM,test/secret
    parse-json-secrets: true
```

The secret `test/secret` has the following secret value.
​
```
{
  "api_user": "user",
  "api_key": "key",
  "config": {
    "active": "true"
  }
}
```

Environment variables created:
​
```
CUSTOM_API_USER: "user"
CUSTOM_API_KEY: "key"
CUSTOM_CONFIG_ACTIVE: "true"
```

> **Pro-tip**: It's possible remove prefixes by providing an "empty" prefix:
>
> ```
> - name: Get Secrets by Name and by ARN
>   uses: aws-actions/aws-secretsmanager-get-secrets@v1
>   with:
>     secret-ids: |
>       ,test/secret
>     parse-json-secrets: true
> ```

## Security

See [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications) for more information.

## License

This library is licensed under the MIT-0 License. See the LICENSE file.

