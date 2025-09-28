import { describe, it, expect } from "vitest";
import gql from "graphql-tag";
import { createPlanner } from "@/src/core/planner";
import { compilePlan } from "@/src/compiler";

describe("Planner", () => {
  describe('getPlan', () => {
    it("returns cached plan for DocumentNode operations (identity stable)", () => {
      const planner = createPlanner();

      const DOC = gql`
        query Q { user(id: "1") { id } }
      `;

      const p1 = planner.getPlan(DOC);
      const p2 = planner.getPlan(DOC);

      expect(p1).toBeDefined();
      expect(p1.operation).toBe("query");
      expect(p1.rootTypename).toBe("Query");
      expect(p2).toBe(p1); // identity from cache
    });

    it("returns cached plan for string operations (identity stable)", () => {
      const planner = createPlanner();

      const STR = `query Q { user(id: "1") { id } }`;

      const p1 = planner.getPlan(STR);
      const p2 = planner.getPlan(STR);

      expect(p1).toBeDefined();
      expect(p1.operation).toBe("query");
      expect(p2).toBe(p1);
    });

    it("compiles a single-fragment document (operation = 'fragment')", () => {
      const planner = createPlanner();

      const FRAG = gql`
        fragment PostFields on Post { id title }
      `;

      const plan = planner.getPlan(FRAG);
      expect(plan.operation).toBe("fragment");
      expect(plan.rootTypename).toBe("Post");
      expect(plan.networkQuery).toBeTruthy();
    });

    it("throws for multi-fragment docs without fragmentName", () => {
      const planner = createPlanner();

      const MULTI = gql`
        fragment A on Post { id }
        fragment B on User { id }
      `;

      expect(() => planner.getPlan(MULTI)).toThrow(/fragmentName/i);
    });

    it("selects fragment by name for multi-fragment docs; caches per fragment", () => {
      const planner = createPlanner();

      const MULTI = gql`
        fragment A on Post { id title }
        fragment B on User { id email }
      `;

      const planA1 = planner.getPlan(MULTI, { fragmentName: "A" });
      const planA2 = planner.getPlan(MULTI, { fragmentName: "A" });
      const planB1 = planner.getPlan(MULTI, { fragmentName: "B" });
      const planB2 = planner.getPlan(MULTI, { fragmentName: "B" });

      expect(planA1.operation).toBe("fragment");
      expect(planA1.rootTypename).toBe("Post");
      expect(planA2).toBe(planA1); // cached identity

      expect(planB1.operation).toBe("fragment");
      expect(planB1.rootTypename).toBe("User");
      expect(planB2).toBe(planB1); // cached identity

      expect(planA1).not.toBe(planB1); // different cache entries
    });

    it("accepts precompiled plans and returns them as-is", () => {
      const planner = createPlanner();

      const DOC = gql`query X { user(id:"1"){ id } }`;
      const pre = compilePlan(DOC);

      const got = planner.getPlan(pre);
      expect(got).toBe(pre);
    });

    it("supports fragmentName with string sources (multi-fragment)", () => {
      const planner = createPlanner();

      const STR = `
        fragment A on Post { id title }
        fragment B on User { id email }
      `;

      const planA = planner.getPlan(STR, { fragmentName: "A" });
      const planB = planner.getPlan(STR, { fragmentName: "B" });

      expect(planA.operation).toBe("fragment");
      expect(planA.rootTypename).toBe("Post");
      expect(planB.operation).toBe("fragment");
      expect(planB.rootTypename).toBe("User");
    });
  });
});
