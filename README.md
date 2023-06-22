# Use AWS Secrets Manager secrets in GitHub jobs
​
To use a secret in a GitHub job, you can use a GitHub action to retrieve secrets from AWS Secrets Manager and add them as masked Action outputs, accessable from the [`steps` context](https://docs.github.com/en/actions/learn-github-actions/contexts#steps-context) in your GitHub workflow. For more information about GitHub Actions, see [Understanding GitHub Actions](https://docs.github.com/en/actions/learn-github-actions/understanding-github-actions) in the *GitHub Docs*.
​
​

Output variables have stricter naming requirements than secrets, so this action transforms secret names to meet those requirements. For example, the action transforms special characters like `@/:` to underscores. Because of the transformed names, two output variables might end up with the same name. For example, a secret named "app/secret" and a secret named "app@secret" would both become output variables named "app_secret". In this case, the action will fail, to avoid accidentally overwriting a secret you intended to use. Instead, you must specify the name you want to use for the output variable.
​

You can set the entire string in the secret value as the output variable value, or if the string is JSON, you can parse the JSON to set individual output variables for each JSON key-value pair. If the secret value is a binary, the action converts it to a string.
​

To view the output variables created from your secrets, turn on debug logging. For more information, see [Enabling debug logging](https://docs.github.com/en/actions/monitoring-and-troubleshooting-workflows/enabling-debug-logging) in the *GitHub Docs*.
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
```yaml
- name: Step name
  id: secret-step-id
  uses: aws-actions/aws-secretsmanager-get-secrets@v2
  with:
    secret-ids: |
      secretId1
      OUT_VAR, secretId2
    parse-json-secrets: (Optional) true|false
```

The secrets you retrieve will be available as outputs from the step in which you used this action. To access them, you will need to use the `steps` context, setting them as environment variables or passing them to other actions as needed. You can choose your own id to replace `secret-step-id` in the above snippet.

For example:
```yaml
- name: Step that uses secrets
  env:
    MY_SECRET: ${{ steps.secret-step-id.outputs.secretId1 }}
  run: auth.sh --secret $MY_SECRET
```

### Parameters

- `secret-ids`: Secret ARNS, names, and name prefixes. 

By default, the step creates each output variable name from the secret name, transformed to include only letters, numbers, and underscores, and so that it doesn't begin with a number. 

To set the output variable name, enter it before the secret ID, followed by a comma. For example `OUT_VAR_1, secretId` creates an output variable named **OUT_VAR_1** from the secret `secretId` which will be accessible at `${{ steps.secret-step-id.outputs.OUT_VAR_1 }}`. 

The output variable name can consist of letters, numbers, and underscores.  

To use a prefix, enter at least three characters followed by an asterisk. For example `dev*` matches all secrets with a name beginning in **dev**. The maximum number of matching secrets that can be retrieved is 100. If you set the variable name, and the prefix matches multiple secrets, then the action fails.
​
- `parse-json-secrets`

(Optional - default false) By default, the action sets the output variable value to the entire JSON string in the secret value. 

Set `parse-json-secrets` to `true` to return variables for each key/value pair in the JSON.
​
### Examples
​
**Example 1: Get secrets by name and by ARN**  
The following example returns output variables for secrets identified by name and by ARN.  
​
```yaml
- name: Get secrets by name and by ARN
  id: secrets-step
  uses: aws-actions/aws-secretsmanager-get-secrets@v2
  with:
    secret-ids: |
      exampleSecretName
      arn:aws:secretsmanager:us-east-2:123456789012:secret:test1-a1b2c3
      0/test/secret
      /prod/example/secret
      SECRET_ALIAS_1,test/secret
      SECRET_ALIAS_2,arn:aws:secretsmanager:us-east-2:123456789012:secret:test2-a1b2c3
```


Outputs returned:  
​
```
${{ steps.secrets-step.outputs.exampleSecretName }}: secretValue1
${{ steps.secrets-step.outputs.test1 }}: secretValue2
${{ steps.secrets-step.outputs._0_test_secret }}: secretValue3
${{ steps.secrets-step.outputs._prod_example_secret }}: secretValue4
${{ steps.secrets-step.outputs.SECRET_ALIAS_1 }}: secretValue5
${{ steps.secrets-step.outputs.SECRET_ALIAS_2 }}: secretValue6
```
​
**Example 2: Get all secrets that begin with a prefix**  
The following example creates output variables for all secrets with names that begin with *beta*.  
​
```yaml
- name: Get Secret Names by Prefix
  uses: aws-actions/aws-secretsmanager-get-secrets@v1
  with:
    secret-ids: |
      beta*    # Retrieves all secrets that start with 'beta'
```
Assuming the search for `beta` produces 3 results (`betaSecretName`, `betaTest` and `beta/NewSecret`, the following output variables are created:  
​
```
${{ steps.secrets-step.outputs.betaSecretName }}: secretValue1
${{ steps.secrets-step.outputs.betaTest }}: secretValue2
${{ steps.secrets-step.outputs.beta_NewSecret }}: secretValue3
```
​
**Example 3: Parse JSON in secret**  
The following example creates output variables by parsing the JSON in the secret.  
​
```yaml
- name: Get Secrets by Name and by ARN
  uses: aws-actions/aws-secretsmanager-get-secrets@v1
  with:
    secret-ids: |
      test/secret
    parse-json-secrets: true
```
The secret `test/secret` has the following secret value.  
​
```json
{
  "api_user": "user",
  "api_key": "key",
  "config": {
    "active": "true"
  }
}
```
Output variables created:  
​
```
${{ steps.secrets-step.outputs.test_secret_api_user }}: "user"
${{ steps.secrets-step.outputs.test_secret_api_key }}: "key"
${{ steps.secrets-step.outputs.test_secret_config_active }}: "true"
```

## Security

See [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications) for more information.

## License

This library is licensed under the MIT-0 License. See the LICENSE file.

