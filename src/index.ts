import * as core from '@actions/core';
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { NodeHttpHandler } from '@aws-sdk/node-http-handler';
import { HttpsProxyAgent } from 'hpagent';
import { CLEANUP_NAME } from "./constants";
import {
	buildSecretsList, extractAliasAndSecretIdFromInput, getSecretValue,
	injectSecret, isSecretArn, SecretValueResponse
} from "./utils";



export async function run(): Promise<void> {
	try {
		//Get Proxy
		const proxyServer = core.getInput('http-proxy', { required: false });
		const agent = new HttpsProxyAgent({ proxy: proxyServer });

		// Default client region is set by configure-aws-credentials
		const client: SecretsManagerClient = new SecretsManagerClient({
			region: process.env.AWS_DEFAULT_REGION,
			customUserAgent: "github-action",
			requestHandler: new NodeHttpHandler({
				httpAgent: agent,
				httpsAgent: agent
			})
		});
		const secretConfigInputs: string[] = [...new Set(core.getMultilineInput('secret-ids'))];
		const parseJsonSecrets = core.getBooleanInput('parse-json-secrets');


		// Get final list of secrets to request
		core.info('Building secrets list...');
		const secretIds: string[] = await buildSecretsList(client, secretConfigInputs);

		// Keep track of secret names that will need to be cleaned from the environment
		let secretsToCleanup = [] as string[];

		core.info('Your secret names may be transformed in order to be valid environment variables (see README). Enable Debug logging in order to view the new environment names.');


		// Get and inject secret values
		for (let secretId of secretIds) {
			//  Optionally let user set an alias, i.e. `ENV_NAME,secret_name`
			let secretAlias = '';
			[secretAlias, secretId] = extractAliasAndSecretIdFromInput(secretId);

			// Retrieves the secret name also, if the value is an ARN
			const isArn = isSecretArn(secretId);

			try {
				const secretValueResponse: SecretValueResponse = await getSecretValue(client, secretId);
				if (!secretAlias) {
					secretAlias = isArn ? secretValueResponse.name : secretId;
				}

				const injectedSecrets = injectSecret(secretAlias, secretValueResponse.secretValue, parseJsonSecrets);
				secretsToCleanup = [...secretsToCleanup, ...injectedSecrets];
			} catch (err) {
				// Fail action for any error
				core.setFailed(`Failed to fetch secret: '${secretId}'. Error: ${err}.`)
			}
		}

		// Export the names of variables to clean up after completion
		core.exportVariable(CLEANUP_NAME, JSON.stringify(secretsToCleanup));

		core.info("Completed adding secrets.");
	} catch (error) {
		if (error instanceof Error) core.setFailed(error.message)
	}
}



run();