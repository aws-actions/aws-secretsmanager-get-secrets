import { nameTransformationTest } from "../name_transformation.base";

describe('No Transformation Variables Assert', () => {
    nameTransformationTest(secretName => secretName);
});
