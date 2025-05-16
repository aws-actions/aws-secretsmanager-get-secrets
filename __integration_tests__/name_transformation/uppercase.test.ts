import { nameTransformationTest } from "../name_transformation.base";

describe("Uppercased Transformation Variables Assert", () => {
  nameTransformationTest((secretName) => secretName.toUpperCase());
});
