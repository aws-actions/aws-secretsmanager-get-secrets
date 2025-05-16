describe("parse-json-secrets: false Variables Assert", () => {
  it("Has secret name, does not have json keys ", () => {
    expect(process.env.JSONSECRET).not.toBeUndefined();
    expect(process.env.JSONSECRET_API_USER).toBeUndefined();
    expect(process.env.JSONSECRET_API_KEY).toBeUndefined();
    expect(process.env.JSONSECRET_CONFIG_ACTIVE).toBeUndefined();
  });
});
