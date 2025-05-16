import * as core from "@actions/core";
import { CLEANUP_NAME } from "./constants";
import { cleanVariable } from "./utils";

/**
 * When the GitHub Actions job is done, clean up any environment variables that
 * may have been set by the job (https://github.com/aws-actions/configure-aws-credentials/blob/master/cleanup.js)
 *
 * Environment variables are not intended to be shared across different jobs in
 * the same GitHub Actions workflow: GitHub Actions documentation states that
 * each job runs in a fresh instance.  However, doing our own cleanup will
 * give us additional assurance that these environment variables are not shared
 * with any other jobs.
 */
export async function cleanup(): Promise<void> {
  try {
    const cleanupSecrets = process.env[CLEANUP_NAME];

    if (cleanupSecrets) {
      // The GitHub Actions toolkit does not have an option to completely unset
      // environment variables, so we overwrite the current value with an empty
      // string.
      JSON.parse(cleanupSecrets).forEach((env: string) => {
        cleanVariable(env);

        if (!process.env[env]) {
          core.debug(`Removed secret: ${env}`);
        } else {
          throw new Error(`Failed to clean secret from environment: ${env}.`);
        }
      });

      // Clean overall secret list
      cleanVariable(CLEANUP_NAME);
    }

    core.info("Cleanup complete.");
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message);
  }
}

cleanup();
