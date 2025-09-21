// test/unit/compiler/compile-formats.test.ts
import { describe, it, expect } from "vitest";
import gql from "graphql-tag";
import { compileToPlan } from "@/src/compiler";
import {
  collectConnectionDirectives,
  everySelectionSetHasTypename,
} from "@/test/helpers";

describe("compiler: compileToPlan — accepts string | gql(DocumentNode) | plan", () => {
  it("accepts a raw GraphQL string", () => {
    const QUERY_STR = `
      query User($id: ID!) {
        user(id: $id) {
          id
          email
        }
      }
    `;

    const plan = compileToPlan(QUERY_STR);

    expect(plan.__kind).toBe("CachePlanV1");
    expect(plan.operation).toBe("query");
    expect(plan.rootTypename).toBe("Query");

    // root has 'user' field
    const userField = plan.rootSelectionMap!.get("user");
    expect(userField?.fieldName).toBe("user");

    // Network doc: no @connection and __typename is materialized everywhere
    expect(collectConnectionDirectives(plan.networkQuery)).toEqual([]);
    expect(everySelectionSetHasTypename(plan.networkQuery)).toBe(true);
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

    const plan = compileToPlan(QUERY_GQL);

    expect(plan.__kind).toBe("CachePlanV1");
    expect(plan.operation).toBe("query");
    expect(plan.rootTypename).toBe("Query");

    const userField = plan.rootSelectionMap!.get("user");
    expect(userField?.fieldName).toBe("user");

    // Network doc: no @connection and __typename is materialized everywhere
    expect(collectConnectionDirectives(plan.networkQuery)).toEqual([]);
    expect(everySelectionSetHasTypename(plan.networkQuery)).toBe(true);
  });

  it("accepts a precompiled plan (pass-through identity)", () => {
    const DOC = `
      query Q { ping { value } }
    `;
    const plan1 = compileToPlan(DOC);
    const plan2 = compileToPlan(plan1);

    // exact same object instance is passed through
    expect(plan2).toBe(plan1);
    expect(plan2.operation).toBe("query");
    expect(plan2.rootTypename).toBe("Query");

    // Network doc still meets the invariants
    expect(collectConnectionDirectives(plan2.networkQuery)).toEqual([]);
    expect(everySelectionSetHasTypename(plan2.networkQuery)).toBe(true);
  });
});
