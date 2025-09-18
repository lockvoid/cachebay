// src/compiler/lowering/args.ts
import type { ArgumentNode, ValueNode } from "graphql";
import type { ArgBuilder } from "../types";

/**
 * Evaluate a GraphQL ValueNode to a JS value using provided variables.
 * - Omits undefined variables (but preserves nulls)
 * - Handles ObjectValue, ListValue recursively
 */
export const evaluateValueNode = (
  valueNode: ValueNode,
  variables: Record<string, any>
): any => {
  switch (valueNode.kind) {
    case "NullValue":
      return null;
    case "IntValue":
      return Number(valueNode.value);
    case "FloatValue":
      return Number(valueNode.value);
    case "StringValue":
      return valueNode.value;
    case "BooleanValue":
      return valueNode.value;
    case "EnumValue":
      return valueNode.value;
    case "Variable":
      return variables ? variables[valueNode.name.value] : undefined;
    case "ListValue": {
      const length = valueNode.values.length;
      const output = new Array(length);
      for (let i = 0; i < length; i++) {
        output[i] = evaluateValueNode(valueNode.values[i], variables);
      }
      return output;
    }
    case "ObjectValue": {
      const output: Record<string, any> = {};
      const fields = valueNode.fields;
      for (let i = 0; i < fields.length; i++) {
        const field = fields[i];
        output[field.name.value] = evaluateValueNode(field.value, variables);
      }
      return output;
    }
  }
};

/**
 * Precompile an argument builder from field arguments.
 * Ensures stable key order (by AST order) and omission of undefineds.
 */
export const compileArgBuilder = (
  argsAst: readonly ArgumentNode[] | undefined
): ArgBuilder => {
  const entries: { name: string; valueNode: ValueNode }[] = [];
  if (argsAst && argsAst.length > 0) {
    for (let i = 0; i < argsAst.length; i++) {
      const a = argsAst[i];
      entries.push({ name: a.name.value, valueNode: a.value });
    }
  }

  return (variables: Record<string, any>): Record<string, any> => {
    if (entries.length === 0) {
      return {};
    }
    const output: Record<string, any> = {};
    for (let i = 0; i < entries.length; i++) {
      const { name, valueNode } = entries[i];
      const evaluated = evaluateValueNode(valueNode, variables);
      if (evaluated !== undefined) {
        output[name] = evaluated;
      }
    }
    return output;
  };
};
