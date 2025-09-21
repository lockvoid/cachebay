<script setup lang="ts">
import { ref } from 'vue';
import type { Ref } from 'vue';

interface SpellForm {
  name: string;
  incantation: string;
  effect: string;
  type: string;
  light: string;
}

const props = defineProps<{
  spell: Partial<SpellForm>;
  loading?: boolean;
}>();

const emit = defineEmits<{
  (e: 'submit', values: SpellForm): void;
}>();

// Simple form state
const form = ref<SpellForm>({
  name: props.spell.name || '',
  incantation: props.spell.incantation || '',
  effect: props.spell.effect || '',
  type: props.spell.type || '',
  light: props.spell.light || ''
});

// Form errors
const errors: Ref<Record<keyof SpellForm, string>> = ref({
  name: '',
  incantation: '',
  effect: '',
  type: '',
  light: ''
});

// Form submission state
const isSubmitting = ref(false);

// Simple validation
const validate = (): boolean => {
  let isValid = true;
  const newErrors = { ...errors.value };
  
  // Validate name
  if (!form.value.name.trim()) {
    newErrors.name = 'Name is required';
    isValid = false;
  } else if (form.value.name.length < 2) {
    newErrors.name = 'Name must be at least 2 characters';
    isValid = false;
  } else {
    newErrors.name = '';
  }

  // Validate incantation
  if (!form.value.incantation.trim()) {
    newErrors.incantation = 'Incantation is required';
    isValid = false;
  } else if (form.value.incantation.length < 2) {
    newErrors.incantation = 'Incantation must be at least 2 characters';
    isValid = false;
  } else {
    newErrors.incantation = '';
  }

  // Validate effect
  if (!form.value.effect.trim()) {
    newErrors.effect = 'Effect is required';
    isValid = false;
  } else if (form.value.effect.length < 10) {
    newErrors.effect = 'Effect must be at least 10 characters';
    isValid = false;
  } else {
    newErrors.effect = '';
  }

  // Validate type
  if (!form.value.type) {
    newErrors.type = 'Type is required';
    isValid = false;
  } else {
    newErrors.type = '';
  }

  // Validate light
  if (!form.value.light) {
    newErrors.light = 'Light color is required';
    isValid = false;
  } else {
    newErrors.light = '';
  }

  errors.value = newErrors;
  return isValid;
};

// Handle form submission
const onSubmit = async () => {
  if (!validate()) return;
  
  isSubmitting.value = true;
  try {
    await emit('submit', form.value);
  } finally {
    isSubmitting.value = false;
  }
};

// Bind form field to input
const bind = (field: keyof SpellForm) => ({
  value: form.value[field],
  'onUpdate:value': (value: string) => {
    form.value[field] = value;
    // Clear error when user types
    if (errors.value[field]) {
      const newErrors = { ...errors.value };
      newErrors[field] = '';
      errors.value = newErrors;
    }
  }
});

// Clean up any potential duplicate handlers in development
if (process.dev && typeof window !== 'undefined') {
  (window as any).handleSubmit = undefined;
}

const spellTypes = [
  'Charm',
  'Curse',
  'Enchantment',
  'Hex',
  'Jinx',
  'Spell',
  'Transfiguration'
];

const lightColors = [
  'Blue',
  'Green',
  'Red',
  'Gold',
  'Silver',
  'White',
  'Black',
  'Purple',
  'Yellow',
  'Orange'
];

</script>

<template>
  <form @submit.prevent="onSubmit" class="space-y-6">
    <!-- Name Field -->
    <div>
      <label for="name" class="block text-sm font-medium text-gray-700">
        Spell Name
      </label>
      <input
        v-bind="bind('name')"
        id="name"
        type="text"
        class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
        :class="{ 'border-red-500': errors.name }"
      />
      <div v-if="errors.name" class="text-red-500 text-sm mt-1">
        {{ errors.name }}
      </div>
    </div>

    <!-- Incantation Field -->
    <div>
      <label for="incantation" class="block text-sm font-medium text-gray-700">
        Incantation
      </label>
      <input
        v-bind="bind('incantation')"
        id="incantation"
        type="text"
        class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
        :class="{ 'border-red-500': errors.incantation }"
      />
      <div v-if="errors.incantation" class="text-red-500 text-sm mt-1">
        {{ errors.incantation }}
      </div>
    </div>

    <!-- Effect Field -->
    <div>
      <label for="effect" class="block text-sm font-medium text-gray-700">
        Effect
      </label>
      <textarea
        v-bind="bind('effect')"
        id="effect"
        rows="3"
        class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
        :class="{ 'border-red-500': errors.effect }"
      ></textarea>
      <div v-if="errors.effect" class="text-red-500 text-sm mt-1">
        {{ errors.effect }}
      </div>
    </div>

    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <!-- Type Field -->
      <div>
        <label for="type" class="block text-sm font-medium text-gray-700">
          Type
        </label>
        <select
          v-bind="bind('type')"
          id="type"
          class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
          :class="{ 'border-red-500': errors.type }"
        >
          <option value="">Select a type</option>
          <option v-for="type in spellTypes" :key="type" :value="type">
            {{ type }}
          </option>
        </select>
        <div v-if="errors.type" class="text-red-500 text-sm mt-1">
          {{ errors.type }}
        </div>
      </div>

      <!-- Light Color Field -->
      <div>
        <label for="light" class="block text-sm font-medium text-gray-700">
          Light Color
        </label>
        <select
          v-bind="bind('light')"
          id="light"
          class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
          :class="{ 'border-red-500': errors.light }"
        >
          <option value="">Select a color</option>
          <option v-for="color in lightColors" :key="color" :value="color">
            {{ color }}
          </option>
        </select>
        <div v-if="errors.light" class="text-red-500 text-sm mt-1">
          {{ errors.light }}
        </div>
      </div>
    </div>

    <!-- Form Actions -->
    <div class="flex justify-end space-x-3">
      <NuxtLink
        to="/"
        class="button-secondary px-4 py-2"
      >
        Cancel
      </NuxtLink>
      <button
        @click="onSubmit"
        type="submit"
        class="button-primary py-2 px-4 disabled:opacity-50"
        :disabled="isSubmitting || loading"
      >
        <span v-if="isSubmitting || loading" class="inline-flex items-center">
          <svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          Saving...
        </span>
        <span v-else>Save</span>
      </button>
    </div>
  </form>
</template>
