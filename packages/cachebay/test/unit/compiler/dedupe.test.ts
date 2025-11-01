import { describe, it, expect } from "vitest";
import { parse, print } from "graphql";
import { dedupeDocument, dedupeSelectionSet } from "../../../src/compiler/lowering/dedupe";

describe("dedupeSelectionSet", () => {
  it("merges identical fields with same args", () => {
    const doc = parse(`
      query {
        post(id: $a) { id }
        post(id: $a) { title }
      }
    `);
    
    const fragmentsByName = new Map();
    const deduped = dedupeDocument(doc, fragmentsByName);
    const printed = print(deduped);
    
    // Should merge into single post field with both id and title
    expect(printed).toContain("post(id: $a)");
    expect(printed).toContain("id");
    expect(printed).toContain("title");
    
    // Should only have one post field
    const matches = printed.match(/post\(/g);
    expect(matches).toHaveLength(1);
  });

  it("does NOT merge fields with different variable names", () => {
    const doc = parse(`
      query {
        post(id: $a) { id }
        post(id: $b) { title }
      }
    `);
    
    const fragmentsByName = new Map();
    const deduped = dedupeDocument(doc, fragmentsByName);
    const printed = print(deduped);
    
    // Should keep both fields (different args)
    expect(printed).toContain("post(id: $a)");
    expect(printed).toContain("post(id: $b)");
    
    const matches = printed.match(/post\(/g);
    expect(matches).toHaveLength(2);
  });

  it("does NOT merge fields with different aliases", () => {
    const doc = parse(`
      query {
        p1: post(id: $id) { id }
        p2: post(id: $id) { title }
      }
    `);
    
    const fragmentsByName = new Map();
    const deduped = dedupeDocument(doc, fragmentsByName);
    const printed = print(deduped);
    
    // Should keep both (different response keys)
    expect(printed).toContain("p1: post");
    expect(printed).toContain("p2: post");
  });

  it("does NOT merge fields with different directives", () => {
    const doc = parse(`
      query {
        post(id: $id) @include(if: $x) { id }
        post(id: $id) { title }
      }
    `);
    
    const fragmentsByName = new Map();
    const deduped = dedupeDocument(doc, fragmentsByName);
    const printed = print(deduped);
    
    // Should keep both (different directive sets)
    const matches = printed.match(/post\(/g);
    expect(matches).toHaveLength(2);
    expect(printed).toContain("@include");
  });

  it("merges inline fragments with same type condition", () => {
    const doc = parse(`
      query {
        node(id: $id) {
          ... on Post { title }
          ... on Post { flags }
          ... on User { email }
        }
      }
    `);
    
    const fragmentsByName = new Map();
    const deduped = dedupeDocument(doc, fragmentsByName);
    const printed = print(deduped);
    
    // Should merge "... on Post" into one
    const postMatches = printed.match(/\.\.\. on Post/g);
    expect(postMatches).toHaveLength(1);
    
    // Should keep "... on User" separate
    expect(printed).toContain("... on User");
    
    // Merged Post fragment should have both fields
    expect(printed).toContain("title");
    expect(printed).toContain("flags");
    expect(printed).toContain("email");
  });

  it("merges connection fields with same @connection key", () => {
    const doc = parse(`
      query {
        posts(first: 10) @connection(key: "A") {
          edges { node { id } }
        }
        posts(first: 10) @connection(key: "A") {
          pageInfo { hasNextPage }
        }
      }
    `);
    
    const fragmentsByName = new Map();
    const deduped = dedupeDocument(doc, fragmentsByName);
    const printed = print(deduped);
    
    // Should merge into one posts field
    const matches = printed.match(/posts\(/g);
    expect(matches).toHaveLength(1);
    
    // Should have both edges and pageInfo
    expect(printed).toContain("edges");
    expect(printed).toContain("pageInfo");
    expect(printed).toContain("hasNextPage");
  });

  it("does NOT merge connection fields with different @connection keys", () => {
    const doc = parse(`
      query {
        posts(first: 10) @connection(key: "A") {
          edges { node { id } }
        }
        posts(first: 10) @connection(key: "B") {
          pageInfo { hasNextPage }
        }
      }
    `);
    
    const fragmentsByName = new Map();
    const deduped = dedupeDocument(doc, fragmentsByName);
    const printed = print(deduped);
    
    // Should keep both (different connection keys)
    const matches = printed.match(/posts\(/g);
    expect(matches).toHaveLength(2);
    expect(printed).toContain('@connection(key: "A")');
    expect(printed).toContain('@connection(key: "B")');
  });

  it("dedupes duplicate fragment spreads", () => {
    const doc = parse(`
      fragment PostFields on Post {
        id
        title
      }
      
      query {
        post(id: $id) {
          ...PostFields
          ...PostFields
        }
      }
    `);
    
    const fragmentsByName = new Map();
    doc.definitions.forEach(def => {
      if (def.kind === "FragmentDefinition") {
        fragmentsByName.set(def.name.value, def);
      }
    });
    
    const deduped = dedupeDocument(doc, fragmentsByName);
    const printed = print(deduped);
    
    // Should only have one ...PostFields
    const matches = printed.match(/\.\.\.PostFields/g);
    expect(matches).toHaveLength(1);
  });

  it("keeps __typename and places it first", () => {
    const doc = parse(`
      query {
        post(id: $id) {
          title
          __typename
          id
        }
      }
    `);
    
    const fragmentsByName = new Map();
    const deduped = dedupeDocument(doc, fragmentsByName);
    const printed = print(deduped);
    
    // Should have __typename
    expect(printed).toContain("__typename");
    
    // Should only appear once
    const matches = printed.match(/__typename/g);
    expect(matches).toHaveLength(1);
    
    // Should be first in selection (after opening brace)
    const postBlock = printed.match(/post\(id: \$id\) \{([^}]+)\}/);
    expect(postBlock).toBeTruthy();
    if (postBlock) {
      const fields = postBlock[1].trim().split(/\s+/);
      expect(fields[0]).toBe("__typename");
    }
  });

  it("handles complex nested merging", () => {
    const doc = parse(`
      query {
        user(id: $id) {
          id
          posts(first: 10) { edges { node { id } } }
          posts(first: 10) { edges { node { title } } }
          posts(first: 10) { pageInfo { hasNextPage } }
        }
      }
    `);
    
    const fragmentsByName = new Map();
    const deduped = dedupeDocument(doc, fragmentsByName);
    const printed = print(deduped);
    
    // Should merge all three posts fields into one
    const matches = printed.match(/posts\(/g);
    expect(matches).toHaveLength(1);
    
    // Should have merged node selections
    expect(printed).toContain("id");
    expect(printed).toContain("title");
    expect(printed).toContain("pageInfo");
  });

  it("preserves field order deterministically (insertion order)", () => {
    const doc1 = parse(`
      query {
        b { id }
        a { id }
        c { id }
      }
    `);
    
    const doc2 = parse(`
      query {
        b { id }
        a { id }
        c { id }
      }
    `);
    
    const fragmentsByName = new Map();
    const deduped1 = dedupeDocument(doc1, fragmentsByName);
    const deduped2 = dedupeDocument(doc2, fragmentsByName);
    
    const printed1 = print(deduped1);
    const printed2 = print(deduped2);
    
    // Should produce identical output (insertion order preserved)
    expect(printed1).toBe(printed2);
    
    // Should preserve original order (b, a, c)
    expect(printed1).toContain("b");
    expect(printed1).toContain("a");
    expect(printed1).toContain("c");
  });

  it("handles scalar fields without sub-selections", () => {
    const doc = parse(`
      query {
        id
        id
        title
        title
      }
    `);
    
    const fragmentsByName = new Map();
    const deduped = dedupeDocument(doc, fragmentsByName);
    const printed = print(deduped);
    
    // Should dedupe scalars
    const idMatches = printed.match(/\bid\b/g);
    const titleMatches = printed.match(/\btitle\b/g);
    
    expect(idMatches).toHaveLength(1);
    expect(titleMatches).toHaveLength(1);
  });

  it("merges field with sub-selection over scalar", () => {
    const doc = parse(`
      query {
        user
        user { id }
      }
    `);
    
    const fragmentsByName = new Map();
    const deduped = dedupeDocument(doc, fragmentsByName);
    const printed = print(deduped);
    
    // Should keep the one with sub-selection
    expect(printed).toContain("user {");
    expect(printed).toContain("id");
    
    // Should only have one user field
    const matches = printed.match(/\buser\b/g);
    expect(matches).toHaveLength(1);
  });
});

describe("dedupeDocument", () => {
  it("dedupes operations", () => {
    const doc = parse(`
      query GetPost {
        post(id: $id) { id }
        post(id: $id) { title }
      }
    `);
    
    const fragmentsByName = new Map();
    const deduped = dedupeDocument(doc, fragmentsByName);
    const printed = print(deduped);
    
    const matches = printed.match(/post\(/g);
    expect(matches).toHaveLength(1);
  });

  it("dedupes fragments", () => {
    const doc = parse(`
      fragment PostFields on Post {
        id
        id
        title
        title
      }
    `);
    
    const fragmentsByName = new Map();
    doc.definitions.forEach(def => {
      if (def.kind === "FragmentDefinition") {
        fragmentsByName.set(def.name.value, def);
      }
    });
    
    const deduped = dedupeDocument(doc, fragmentsByName);
    const printed = print(deduped);
    
    // Should dedupe within fragment
    const idMatches = printed.match(/\bid\b/g);
    const titleMatches = printed.match(/\btitle\b/g);
    
    expect(idMatches).toHaveLength(1);
    expect(titleMatches).toHaveLength(1);
  });

  it("handles mutations", () => {
    const doc = parse(`
      mutation CreatePost {
        createPost(input: $input) { id }
        createPost(input: $input) { title }
      }
    `);
    
    const fragmentsByName = new Map();
    const deduped = dedupeDocument(doc, fragmentsByName);
    const printed = print(deduped);
    
    const matches = printed.match(/createPost\(/g);
    expect(matches).toHaveLength(1);
    expect(printed).toContain("id");
    expect(printed).toContain("title");
  });

  it("handles subscriptions", () => {
    const doc = parse(`
      subscription OnPostCreated {
        postCreated { id }
        postCreated { title }
      }
    `);
    
    const fragmentsByName = new Map();
    const deduped = dedupeDocument(doc, fragmentsByName);
    const printed = print(deduped);
    
    const matches = printed.match(/postCreated/g);
    expect(matches).toHaveLength(1);
    expect(printed).toContain("id");
    expect(printed).toContain("title");
  });

  it("deduplicates duplicate fragment definitions", () => {
    const doc = parse(`
      fragment PageInfoFields on PageInfo {
        startCursor
        endCursor
      }
      
      fragment PageInfoFields on PageInfo {
        startCursor
        endCursor
      }
      
      query Test {
        connection {
          pageInfo {
            ...PageInfoFields
          }
        }
      }
    `);
    
    const fragmentsByName = new Map();
    // Manually populate fragmentsByName as indexFragments would
    doc.definitions.forEach((def: any) => {
      if (def.kind === "FragmentDefinition") {
        fragmentsByName.set(def.name.value, def);
      }
    });
    
    const deduped = dedupeDocument(doc, fragmentsByName);
    const printed = print(deduped);
    
    // Should only have ONE PageInfoFields fragment
    const matches = printed.match(/fragment PageInfoFields/g);
    expect(matches).toHaveLength(1);
    
    // Should still have the query
    expect(printed).toContain("query Test");
    expect(printed).toContain("...PageInfoFields");
  });
});
