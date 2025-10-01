import gql from "graphql-tag";
import { compilePlan } from "@/src/compiler";
import { collectConnectionDirectives, hasTypenames } from "@/test/helpers";

describe("Compiler x Formats", () => {
  it("accepts a raw GraphQL string", () => {
    const QUERY_STR = `
      query User($id: ID!) {
        user(id: $id) {
          id
          email
        }
      }
    `;

    const plan = compilePlan(QUERY_STR);

    expect(plan.kind).toBe("CachePlanV1");
    expect(plan.operation).toBe("query");
    expect(plan.rootTypename).toBe("Query");

    const user = plan.rootSelectionMap!.get("user");
    expect(user?.fieldName).toBe("user");

    expect(collectConnectionDirectives(plan.networkQuery)).toEqual([]);
    expect(hasTypenames(plan.networkQuery)).toBe(true);
  });

  it("accepts a DocumentNode produced by graphql-tag's gql", () => {
    const QUERY_GQL = gql`
      query User($id: ID!) {
        user(id: $id) {
          id
          email
        }
      }
    `;

    const plan = compilePlan(QUERY_GQL);

    expect(plan.kind).toBe("CachePlanV1");
    expect(plan.operation).toBe("query");
    expect(plan.rootTypename).toBe("Query");

    const user = plan.rootSelectionMap!.get("user");
    expect(user?.fieldName).toBe("user");

    expect(collectConnectionDirectives(plan.networkQuery)).toEqual([]);
    expect(hasTypenames(plan.networkQuery)).toBe(true);
  });

  it("accepts a precompiled plan (pass-through identity)", () => {
    const QUERY_GQL = gql`
      query User($id: ID!) {
        user(id: $id) {
          id
          email
        }
      }
    `;

    const plan1 = compilePlan(QUERY_GQL);
    const plan2 = compilePlan(plan1);

    expect(plan2).toBe(plan1);
    expect(plan2.operation).toBe("query");
    expect(plan2.rootTypename).toBe("Query");

    expect(collectConnectionDirectives(plan2.networkQuery)).toEqual([]);
    expect(hasTypenames(plan2.networkQuery)).toBe(true);
  });
});
