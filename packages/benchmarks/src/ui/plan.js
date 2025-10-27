// Helper function used in the plan
function valueToJS(v, vars) {
  if (v && typeof v === 'object' && 'kind' in v) {
    switch (v.kind) {
      case 'Variable':
        return vars?.[v.variableName];
      case 'ObjectValue':
        return v.fields.reduce((acc, field) => {
          acc[field.name.value] = valueToJS(field.value, vars);
          return acc;
        }, {});
      case 'ListValue':
        return v.values.map(val => valueToJS(val, vars));
      case 'IntValue':
        return parseInt(v.value, 10);
      case 'FloatValue':
        return parseFloat(v.value);
      case 'BooleanValue':
        return v.value;
      case 'StringValue':
      case 'EnumValue':
        return v.value;
      case 'NullValue':
        return null;
      default:
        return undefined;
    }
  }
  return v;
}

// Helper function to create field definitions
function createField(fieldName, selId, selectionSet = null) {
  return {
    responseKey: fieldName,
    fieldName,
    selectionSet,
    selectionMap: undefined,
    buildArgs: (vars, entries = []) => {
      if (!entries?.length) return {};
      const out = {};
      for (let i = 0; i < entries.length; i++) {
        const [k, v] = entries[i];
        const val = valueToJS(v, vars);
        if (val !== undefined) out[k] = val;
      }
      return out;
    },
    stringifyArgs: () => "",
    expectedArgNames: [],
    isConnection: false,
    connectionKey: undefined,
    connectionFilters: undefined,
    connectionMode: undefined,
    typeCondition: undefined,
    pageArgs: undefined,
    selId: `${fieldName}:${fieldName}`
  };
}

// Create the profile selection set
const profileSelectionSet = [
  'id', 'bio', 'avatar', 'location', 'website', 
  'twitter', 'github', 'linkedin', 'followers', 'following'
].map(field => createField(field, field));

// Create the user selection set
const userSelectionSet = [
  'id', 'name', 'email', 'username', 'phone', 
  'website', 'company', 'bio', 'avatar', 'createdAt'
].map(field => createField(field, field));

// Add the profile field to user selection set
userSelectionSet.push({
  ...createField('profile', 'profile'),
  selectionSet: profileSelectionSet
});

// The plan object
export const plan = {
  kind: 'CachePlan',
  operation: 'query',
  rootTypename: 'Query',
  root: [{
    responseKey: 'user',
    fieldName: 'user',
    selectionSet: userSelectionSet,
    selectionMap: new Map(userSelectionSet.map(field => [field.fieldName, field]))
  }]
};

// Add __typename to all selection sets
function addTypenameToSelectionSet(selectionSet) {
  if (!selectionSet) return;
  
  // Check if __typename already exists
  const hasTypename = selectionSet.some(field => field.fieldName === '__typename');
  if (!hasTypename) {
    selectionSet.push(createField('__typename', '__typename'));
  }
  
  // Recursively add __typename to nested selection sets
  selectionSet.forEach(field => {
    if (field.selectionSet) {
      addTypenameToSelectionSet(field.selectionSet);
    }
  });
}

// Ensure __typename is included in all selection sets
addTypenameToSelectionSet(plan.root[0].selectionSet);
if (plan.root[0].selectionMap) {
  plan.root[0].selectionMap.set('__typename', createField('__typename', '__typename'));
}
