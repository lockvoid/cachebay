// Note: Codename – Patchbay
import { reactive, ref, watch } from "vue";
import * as v from "valibot";

type ValidationMode = "submit" | "change" | "blur";
type Path = string;

type FieldMeta = {
  isTouched: boolean;
  isDirty: boolean;
  isValid: boolean;
  isInvalid: boolean;
  isPending: boolean;
  errors: string[];
};

type Options<S extends v.BaseSchema<any, any, any>> = {
  schema: S;
  validationMode?: ValidationMode;
  onSubmit?: (vals: v.InferOutput<S>) => void | Promise<void>;
};

const isObj = (x: any) => x && typeof x === "object" && !Array.isArray(x);
const clone = <T>(x: T): T => structuredClone(x);
const get = (o: any, p: Path) => p.split(".").reduce((a, k) => (a == null ? a : a[k]), o);
const set = (o: any, p: Path, val: any) => {
  const parts = p.split(".");
  const last = parts.pop()!;
  let cur = o;
  for (const k of parts) {
    if (!isObj(cur[k])) cur[k] = /^\d+$/.test(k) ? [] : {};
    cur = cur[k];
  }
  cur[last] = val;
};
const eq = (a: any, b: any) => JSON.stringify(a) === JSON.stringify(b);
const hasValues = (obj: any) => obj != null && typeof obj === "object" && Object.keys(obj).length > 0;

// Overloads
export function useForm<S extends v.BaseSchema<any, any, any>>(initialValues: v.InferOutput<S>, opts: Options<S>): ReturnType;
export function useForm<S extends v.BaseSchema<any, any, any>>(opts: Options<S>): ReturnType;

type ReturnType = {
  values: any;
  errors: Record<string, string[]>;
  meta: { fields: Record<string, FieldMeta> };
  // top-level flags
  isSubmitting: { value: boolean };
  isValidating: { value: boolean };
  isSubmitted: { value: boolean };
  submitCount: { value: number };
  isTouched: { value: boolean };
  isDirty: { value: boolean };
  isPending: { value: boolean };
  isInvalid: { value: boolean };
  isValid: { value: boolean };
  // actions
  bind: (name: Path) => any;
  validate: () => Promise<ReturnTypeOfSafeParseAsync>;
  submit: () => Promise<ReturnTypeOfSafeParseAsync>;
};

type ReturnTypeOfSafeParseAsync = Awaited<ReturnType<typeof v.safeParseAsync<any>>>;

// Impl
export function useForm<S extends v.BaseSchema<any, any, any>>(arg1: any, arg2?: any): ReturnType {
  let schema: S;
  let initialValues: v.InferOutput<S>;
  let validationMode: ValidationMode = "submit";
  let onSubmit: ((vals: v.InferOutput<S>) => void | Promise<void>) | undefined;

  if (arg2) {
    // (initialValues, options)
    initialValues = arg1 as v.InferOutput<S>;
    const opts = arg2 as Options<S>;
    schema = opts.schema;
    validationMode = opts.validationMode ?? "submit";
    onSubmit = opts.onSubmit;
  } else {
    // (options) — initialValues default {}
    const opts = arg1 as Options<S>;
    schema = opts.schema;
    initialValues = {} as v.InferOutput<S>;
    validationMode = opts.validationMode ?? "submit";
    onSubmit = opts.onSubmit;
  }

  // state
  const values = reactive(clone(initialValues)) as v.InferOutput<S>;
  const _initial = clone(initialValues) as v.InferOutput<S>;
  const errors = reactive<Record<string, string[]>>({});

  // per-field meta
  const fieldMeta = reactive<Record<string, FieldMeta>>({});

  // top-level flags
  const isSubmitting = ref(false);
  const isValidating = ref(false);
  const isSubmitted = ref(false);
  const submitCount = ref(0);

  const isTouched = ref(false);
  const isDirty = ref(false);
  const isPending = ref(false);

  // validity gating
  const hasValidatedOnce = ref(false);

  // default assumption: invalid until validated
  const isInvalid = ref(true);
  const isValid = ref(false);

  const meta = reactive({ fields: fieldMeta });

  const ensureField = (name: Path) => {
    if (!fieldMeta[name]) {
      fieldMeta[name] = {
        isTouched: false,
        isDirty: !eq(get(values, name), get(_initial, name)),
        isValid: false, // start as not valid
        isInvalid: true, // start invalid until validated
        isPending: false,
        errors: [],
      };
      watch(
        () => get(values, name),
        (cur) => {
          fieldMeta[name].isDirty = !eq(cur, get(_initial, name));
        },
        { deep: true },
      );
    }
    return fieldMeta[name];
  };

  const refreshTopLevelFlags = () => {
    const names = Object.keys(fieldMeta);
    isTouched.value = names.some((n) => fieldMeta[n].isTouched);
    isDirty.value = !eq(values, _initial);
    isPending.value = isValidating.value || names.some((n) => fieldMeta[n].isPending);

    if (!hasValidatedOnce.value) {
      // Keep invalid until at least one validation finished
      isInvalid.value = true;
      isValid.value = false;
      return;
    }

    // After first validation, base on errors or field meta
    const anyFieldInvalid = names.some((n) => fieldMeta[n].isInvalid);
    const anyErrors = Object.keys(errors).length > 0;
    isInvalid.value = anyFieldInvalid || anyErrors;
    isValid.value = !isInvalid.value;
  };

  const syncErrorsToMeta = () => {
    for (const n of Object.keys(errors)) ensureField(n);
    for (const n of Object.keys(fieldMeta)) {
      const msgs = errors[n] ?? [];
      const m = fieldMeta[n];
      m.errors = msgs;
      m.isInvalid = msgs.length > 0;
      m.isValid = !m.isInvalid;
    }
  };

  async function validate(): Promise<ReturnTypeOfSafeParseAsync> {
    isValidating.value = true;
    try {
      const res = await v.safeParseAsync(schema, values);
      const flat = res.success ? { nested: {} as Record<string, string[]> } : v.flatten(res.issues);

      // reset + assign errors
      for (const k of Object.keys(errors)) delete errors[k];
      for (const [k, msgs] of Object.entries(flat.nested)) errors[k] = msgs;

      syncErrorsToMeta();

      hasValidatedOnce.value = true;

      refreshTopLevelFlags();
      return res;
    } finally {
      isValidating.value = false;
      refreshTopLevelFlags();
    }
  }

  async function submit(): Promise<ReturnTypeOfSafeParseAsync> {
    isSubmitted.value = true;
    submitCount.value += 1;
    isSubmitting.value = true;
    try {
      const res = await validate();
      if (res.success) await onSubmit?.(values);
      return res;
    } finally {
      isSubmitting.value = false;
      refreshTopLevelFlags();
    }
  }

  if (validationMode === "change") {
    watch(
      () => values,
      () => void validate(),
      { deep: true },
    );
  }

  // auto-run validation if initial data present
  if (hasValues(initialValues)) {
    Promise.resolve().then(() => {
      void validate();
    });
  }

  function bind(name: Path) {
    const m = ensureField(name);
    return {
      modelValue: get(values, name),
      "onUpdate:modelValue": (val: any) => {
        set(values, name, val);
        if (validationMode === "change") void validate();
      },
      onInput: (e: Event) => {
        const val = (e.target as HTMLInputElement).value;
        set(values, name, val);
        if (validationMode === "change") void validate();
      },
      onBlur: async () => {
        m.isTouched = true;
        if (validationMode === "blur") {
          await validate(); // ensure flags update AFTER validation result
        } else {
          // still refresh high-level flags to propagate touched/dirty
          refreshTopLevelFlags();
        }
      },
    };
  }

  return {
    values,
    errors,
    meta,
    isSubmitting,
    isValidating,
    isSubmitted,
    submitCount,
    isTouched,
    isDirty,
    isPending,
    isInvalid,
    isValid,
    bind,
    validate,
    submit,
  };
}

export default useForm;
