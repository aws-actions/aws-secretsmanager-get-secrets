describe('Environment Variables Assert', () => {
    it.each([
        // Standard name qualified test
        ['SAMPLESECRET1', 'SomeSampleSecret1'],
        // Alias test
        ['SAMPLESECRET1_ALIAS', 'SomeSampleSecret1'],
        // Special characters escaping test
        ['_SPECIAL_CHARS_SECRET', 'SomeSampleSecret2'],
        // Secret starting with numerical character escape test
        ['_0_SPECIAL_CHARS_SECRET', 'SomeSampleSecret3'],
        // Prefix matching test
        ['PREFIXSECRET1', 'PrefixSecret1Value'],
        ['PREFIXSECRET2', 'PrefixSecret2Value'],
        // Json value expansion
        ['JSONSECRET_API_USER', 'user'],
        ['JSONSECRET_API_KEY', 'key'],
        ['JSONSECRET_CONFIG_ACTIVE', 'true'],
    ])('Secret with name %s test', (secretName, expectedValue) => {
        const secretValue = process.env[secretName];
        expect(secretValue).toBe(expectedValue);
    });
});