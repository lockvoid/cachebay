import type { CachePlan, PlanField } from 'cachebay';

/**
 * Serialize a CachePlan to JavaScript code.
 * Uses Option 2 (Balanced): Serialize data + import helper functions.
 */
export function serializePlan(plan: CachePlan): string {
  const windowArgsArray = Array.from(plan.windowArgs);
  const fingerprint = plan.selectionFingerprint 
    ? `selectionFingerprint: ${JSON.stringify(plan.selectionFingerprint)},` 
    : '';

  return `({
  kind: "CachePlan",
  operation: "${plan.operation}",
  rootTypename: "${plan.rootTypename}",
  networkQuery: ${JSON.stringify(plan.networkQuery)},
  id: ${plan.id},
  varMask: {
    strict: ${JSON.stringify(plan.varMask.strict)},
    canonical: ${JSON.stringify(plan.varMask.canonical)}
  },
  windowArgs: new Set(${JSON.stringify(windowArgsArray)}),
  ${fingerprint}
  root: ${serializePlanFields(plan.root)},
  makeVarsKey: ${plan.makeVarsKey.toString()},
  makeSignature: ${plan.makeSignature.toString()},
  getDependencies: ${plan.getDependencies.toString()}
})`;
}

/**
 * Serialize an array of PlanField objects.
 */
function serializePlanFields(fields: PlanField[]): string {
  const serialized = fields.map(field => serializePlanField(field));
  return `[${serialized.join(',\n')}]`;
}

/**
 * Serialize a single PlanField.
 */
function serializePlanField(field: PlanField): string {
  const selectionSet = field.selectionSet 
    ? serializePlanFields(field.selectionSet) 
    : 'null';
  
  const typeCondition = field.typeCondition 
    ? `typeCondition: ${JSON.stringify(field.typeCondition)},` 
    : '';
  
  const connectionKey = field.connectionKey 
    ? `connectionKey: ${JSON.stringify(field.connectionKey)},` 
    : '';
  
  const connectionFilters = field.connectionFilters 
    ? `connectionFilters: ${JSON.stringify(field.connectionFilters)},` 
    : '';
  
  const connectionMode = field.connectionMode 
    ? `connectionMode: ${JSON.stringify(field.connectionMode)},` 
    : '';
  
  const selId = field.selId 
    ? `selId: ${JSON.stringify(field.selId)},` 
    : '';
  
  const pageArgs = field.pageArgs 
    ? `pageArgs: ${JSON.stringify(field.pageArgs)}` 
    : '';

  return `{
  responseKey: ${JSON.stringify(field.responseKey)},
  fieldName: ${JSON.stringify(field.fieldName)},
  selectionSet: ${selectionSet},
  ${typeCondition}
  buildArgs: ${field.buildArgs.toString()},
  stringifyArgs: ${field.stringifyArgs.toString()},
  expectedArgNames: ${JSON.stringify(field.expectedArgNames)},
  isConnection: ${field.isConnection},
  ${connectionKey}
  ${connectionFilters}
  ${connectionMode}
  ${selId}
  ${pageArgs}
}`;
}
