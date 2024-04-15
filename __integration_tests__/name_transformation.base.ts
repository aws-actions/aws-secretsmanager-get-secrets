export function nameTransformationTest(transform: (secretName: string) => string) {
    const dataset = [
        // Standard name qualified test
        ['SampleSecret1', 'SomeSampleSecret1'],
        // Special characters escaping test
        ['_special_chars_secret', 'SomeSampleSecret2'],
        // Secret starting with numerical character escape test
        ['_0_special_chars_secret', 'SomeSampleSecret3'],
        // Prefix matching test
        ['PrefixSecret1', 'PrefixSecret1Value'],
        ['PrefixSecret2', 'PrefixSecret2Value'],
        // Json value expansion
        ['JsonSecret_api_user', 'user'],
        ['JsonSecret_api_key', 'key'],
        ['JsonSecret_config_active', 'true'],
        // Alias test
        ['SampleSecret1_Alias', 'SomeSampleSecret1']
    ].map(([secretName, expectedValue]) => [transform(secretName), expectedValue]);

    test.each(dataset)('Secret with name %s test', (secretName, expectedValue) => {
        const secretValue = process.env[secretName];
        expect(secretValue).toBe(expectedValue);
    });
}