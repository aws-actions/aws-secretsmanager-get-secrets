import * as core from '@actions/core'
import { cleanup } from "../src/cleanup";
import { CLEANUP_NAME } from "../src/constants";
import * as utils from "../src/utils";

jest.mock('@actions/core');

const TEST_SECRET_VALUE = "secret";
const TEST_ENVIRONMENT = {
    SECRETS_LIST_CLEAN_UP: JSON.stringify(["TEST_SECRET", "TEST_SECRET_DB_HOST", "TEST_SECRET_API_KEY"]),
    TEST_SECRET: TEST_SECRET_VALUE,
    TEST_SECRET_DB_HOST: TEST_SECRET_VALUE,
    TEST_SECRET_API_KEY: TEST_SECRET_VALUE
};


describe('Test post cleanup action', () => {
    const OLD_ENV = process.env;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env = {...OLD_ENV, ...TEST_ENVIRONMENT};
    });

    afterEach(() => {
        process.env = OLD_ENV;
    });

    test ('Cleans a single variable from the environment', async () => {
        // Test that variable is present
        expect(process.env["TEST_SECRET"]).toEqual(TEST_SECRET_VALUE);

        utils.cleanVariable("TEST_SECRET");

        // Test that variable is removed
        expect(core.exportVariable).toHaveBeenCalledWith('TEST_SECRET', '');
        expect(process.env["TEST_SECRET"]).toBeUndefined();
    });

    test('Replaces AWS credential and region env vars with empty strings', async () => {
        await cleanup();

        expect(core.setFailed).toHaveBeenCalledTimes(0);
        expect(core.exportVariable).toHaveBeenCalledTimes(4);

        expect(core.exportVariable).toHaveBeenCalledWith('TEST_SECRET', '');
        expect(core.exportVariable).toHaveBeenCalledWith('TEST_SECRET_DB_HOST', '');
        expect(core.exportVariable).toHaveBeenCalledWith('TEST_SECRET_API_KEY', '');
        expect(core.exportVariable).toHaveBeenCalledWith(CLEANUP_NAME, '');
    });

    test ('Fails the action if a variable is still present after being cleaned', async () => {
        const utilSpy = jest.spyOn(utils, 'cleanVariable').mockImplementation(() => jest.fn());
        await cleanup();

        // Mocked cleaning did not remove the variable, so this should fail
        expect(core.setFailed).toHaveBeenCalledTimes(1);
    });
});
