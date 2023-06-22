import * as core from '@actions/core'
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import {
    buildSecretsList,
    isSecretArn,
    getSecretValue,
    injectSecret,
    extractAliasAndSecretIdFromInput,
    SecretValueResponse
} from "./utils";

export async function run(): Promise<void> {
    try {
        // Default client region is set by configure-aws-credentials
        const client : SecretsManagerClient = new SecretsManagerClient({region: process.env.AWS_DEFAULT_REGION, customUserAgent: "github-action"});
        const secretConfigInputs: string[] = [...new Set(core.getMultilineInput('secret-ids'))];
        const parseJsonSecrets = core.getBooleanInput('parse-json-secrets');

        // Get final list of secrets to request
        core.info('Building secrets list...');
        const secretIds: string[] = await buildSecretsList(client, secretConfigInputs);

        // Keep track of secrets outputted already, so none are accidentally overwritten
        const injectedSecretIds: Set<string> = new Set;

        core.info('Your secret names may be transformed in order to be valid output variables (see README). Enable Debug logging in order to view the new variable names.');

        // Get and inject secret values
        for (let secretId of secretIds) {
            //  Optionally let user set an alias, i.e. `VAR_NAME,secret_name`
            let secretAlias = '';
            [secretAlias, secretId] = extractAliasAndSecretIdFromInput(secretId);

            // Retrieves the secret name also, if the value is an ARN
            const isArn = isSecretArn(secretId);

            try {
                const secretValueResponse : SecretValueResponse = await getSecretValue(client, secretId);
                if (!secretAlias){
                    secretAlias = isArn ? secretValueResponse.name : secretId;
                }

                injectSecret(secretAlias, secretValueResponse.secretValue, parseJsonSecrets, injectedSecretIds);
            } catch (err) {
                // Fail action for any error
                core.setFailed(`Failed to fetch secret: '${secretId}'. Error: ${err}.`)
            } 
        }

        core.info("Completed adding secrets.");
    } catch (error) {
        if (error instanceof Error) core.setFailed(error.message)
    }
}



run();