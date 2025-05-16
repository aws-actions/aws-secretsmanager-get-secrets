import { nameTransformationTest } from "../name_transformation.base";

describe('Lowercased Transformation Variables Assert', () => {
    nameTransformationTest(secretName => secretName.toLowerCase());
});
