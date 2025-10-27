import { describe, it, expect } from 'vitest';
import { parse } from 'graphql';
import { compilePlan } from 'cachebay';
import { serializePlan } from '../src/serialize';
import { deserializePlan } from '../src/deserialize';

describe('serialize/deserialize', () => {
  it('should serialize and deserialize a simple query', () => {
    const query = `
      query GetUser($id: ID!) {
        user(id: $id) {
          id
          name
          email
        }
      }
    `;

    const document = parse(query);
    const plan = compilePlan(document);
    const serialized = serializePlan(plan);
    const deserialized = deserializePlan(serialized);

    // Verify basic properties
    expect(deserialized.kind).toBe('CachePlan');
    expect(deserialized.operation).toBe('query');
    expect(deserialized.rootTypename).toBe('Query');
    expect(deserialized.id).toBe(plan.id);
    expect(deserialized.networkQuery).toBe(plan.networkQuery);
  });

  it('should preserve varMask correctly', () => {
    const query = `
      query GetUser($id: ID!, $name: String) {
        user(id: $id, name: $name) {
          id
          name
        }
      }
    `;

    const document = parse(query);
    const plan = compilePlan(document);
    const serialized = serializePlan(plan);
    const deserialized = deserializePlan(serialized);

    expect(deserialized.varMask.strict).toEqual(plan.varMask.strict);
    expect(deserialized.varMask.canonical).toEqual(plan.varMask.canonical);
  });

  it('should preserve windowArgs as Set', () => {
    const query = `
      query GetUsers($first: Int, $after: String) {
        users(first: $first, after: $after) @connection(key: "users") {
          edges {
            node {
              id
              name
            }
          }
        }
      }
    `;

    const document = parse(query);
    const plan = compilePlan(document);
    const serialized = serializePlan(plan);
    const deserialized = deserializePlan(serialized);

    expect(deserialized.windowArgs).toBeInstanceOf(Set);
    expect(Array.from(deserialized.windowArgs).sort()).toEqual(
      Array.from(plan.windowArgs).sort()
    );
  });

  it('should preserve PlanField tree structure', () => {
    const query = `
      query GetUser($id: ID!) {
        user(id: $id) {
          id
          name
          profile {
            bio
            avatar
          }
        }
      }
    `;

    const document = parse(query);
    const plan = compilePlan(document);
    const serialized = serializePlan(plan);
    const deserialized = deserializePlan(serialized);

    expect(deserialized.root).toHaveLength(plan.root.length);
    expect(deserialized.root[0].responseKey).toBe(plan.root[0].responseKey);
    expect(deserialized.root[0].fieldName).toBe(plan.root[0].fieldName);
    
    // Check nested fields
    const userField = deserialized.root[0];
    expect(userField.selectionSet).not.toBeNull();
    expect(userField.selectionSet?.length).toBeGreaterThan(0);
  });

  it('should preserve connection metadata', () => {
    const query = `
      query GetUsers($first: Int) {
        users(first: $first) @connection(key: "allUsers", filters: ["status"]) {
          edges {
            node {
              id
              name
            }
          }
        }
      }
    `;

    const document = parse(query);
    const plan = compilePlan(document);
    const serialized = serializePlan(plan);
    const deserialized = deserializePlan(serialized);

    const usersField = deserialized.root[0];
    expect(usersField.isConnection).toBe(true);
    expect(usersField.connectionKey).toBe('allUsers');
    expect(usersField.connectionFilters).toEqual(['status']);
  });

  it('should serialize functions that work correctly', () => {
    const query = `
      query GetUser($id: ID!, $status: String) {
        user(id: $id, status: $status) {
          id
          name
        }
      }
    `;

    const document = parse(query);
    const plan = compilePlan(document);
    const serialized = serializePlan(plan);
    const deserialized = deserializePlan(serialized);

    // Test makeVarsKey
    const vars = { id: '123', status: 'active' };
    const originalKey = plan.makeVarsKey(false, vars);
    const deserializedKey = deserialized.makeVarsKey(false, vars);
    expect(deserializedKey).toBe(originalKey);

    // Test makeSignature
    const originalSig = plan.makeSignature(false, vars);
    const deserializedSig = deserialized.makeSignature(false, vars);
    expect(deserializedSig).toBe(originalSig);

    // Test getDependencies
    const originalDeps = plan.getDependencies(false, vars);
    const deserializedDeps = deserialized.getDependencies(false, vars);
    expect(Array.from(deserializedDeps).sort()).toEqual(
      Array.from(originalDeps).sort()
    );
  });

  it('should handle canonical vs strict mode correctly', () => {
    const query = `
      query GetUsers($status: String, $first: Int, $after: String) {
        users(status: $status, first: $first, after: $after) @connection(key: "users") {
          edges {
            node {
              id
              name
            }
          }
        }
      }
    `;

    const document = parse(query);
    const plan = compilePlan(document);
    const serialized = serializePlan(plan);
    const deserialized = deserializePlan(serialized);

    const vars = { status: 'active', first: 10, after: 'cursor123' };

    // Canonical should exclude pagination args
    const canonicalKey = deserialized.makeVarsKey(true, vars);
    expect(canonicalKey).not.toContain('first');
    expect(canonicalKey).not.toContain('after');
    expect(canonicalKey).toContain('status');

    // Strict should include all args
    const strictKey = deserialized.makeVarsKey(false, vars);
    expect(strictKey).toContain('first');
    expect(strictKey).toContain('after');
    expect(strictKey).toContain('status');
  });

  it('should handle buildArgs and stringifyArgs functions', () => {
    const query = `
      query GetUser($id: ID!, $limit: Int) {
        user(id: $id) {
          posts(limit: $limit) {
            id
            title
          }
        }
      }
    `;

    const document = parse(query);
    const plan = compilePlan(document);
    const serialized = serializePlan(plan);
    const deserialized = deserializePlan(serialized);

    const vars = { id: '123', limit: 5 };
    
    // Find the posts field
    const userField = deserialized.root[0];
    const postsField = userField.selectionSet?.find(f => f.fieldName === 'posts');
    
    expect(postsField).toBeDefined();
    expect(typeof postsField?.buildArgs).toBe('function');
    expect(typeof postsField?.stringifyArgs).toBe('function');

    // Test that functions work
    const args = postsField?.buildArgs(vars);
    expect(args).toEqual({ limit: 5 });

    const argsString = postsField?.stringifyArgs(vars);
    expect(argsString).toContain('limit');
  });

  it('should handle fragment queries', () => {
    const query = `
      fragment UserFields on User {
        id
        name
        email
      }

      query GetUser($id: ID!) {
        user(id: $id) {
          ...UserFields
        }
      }
    `;

    const document = parse(query);
    const plan = compilePlan(document);
    const serialized = serializePlan(plan);
    const deserialized = deserializePlan(serialized);

    expect(deserialized.kind).toBe('CachePlan');
    expect(deserialized.operation).toBe('query');
    
    // Fragments should be inlined in the plan
    const userField = deserialized.root[0];
    expect(userField.selectionSet).not.toBeNull();
    expect(userField.selectionSet?.length).toBeGreaterThan(0);
  });
});
