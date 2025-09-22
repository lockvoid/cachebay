<script setup lang="ts">
  import { useForm } from '@lockvoid/vue-form'
  import * as v from 'valibot'

  const SPELL_CATEGORIES = [
    'Charm',
    'Curse',
    'Enchantment',
    'Hex',
    'Jinx',
    'Spell',
    'Transfiguration'
  ];

  const LIGHT_COLORS = [
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

  interface SpellForm {
    id?: string;
    name?: string;
    effect?: string;
    category?: string;
    creator?: string;
    light?: string;
    image?: string;
    wiki?: string;
  }

  const props = defineProps({
    spell: {
      type: Object as PropType<Partial<SpellForm>>,
      required: true
    },

    onSubmit: {
      type: Function as PropType<(values: SpellForm) => Promise<void> | void>,
      required: true
    },

    onDelete: {
      type: Function as PropType<(id: string) => Promise<void> | void>,
      required: true
    }
  });

  const emit = defineEmits<{
    (e: 'success'): void;
  }>();

  const schema = v.pipe(
    v.object({
      name: v.pipe(v.string(), v.trim(), v.minLength(1, 'Name is required')),
      effect: v.pipe(v.string(), v.trim(), v.minLength(1, 'Effect is required')),
      category: v.pipe(v.string(), v.minLength(1, 'Category is required')),
      creator: v.optional(v.string()),
      light: v.optional(v.string()),
      imageUrl: v.optional(v.string()),
      wikiUrl: v.optional(v.string())
    })
  )

  const form = useForm({
    schema,

    initialValues: props.spell,

    onSubmit: async (values) => {
      await props.onSubmit(values as SpellForm)

      emit('success')
    }
  })
</script>

<template>
  <form @submit.prevent="form.submit" class="space-y-6">
    <div>
      <label for="name" class="block text-sm  text-gray-700 mb-2">
        Spell
      </label>

      <input v-bind="form.bind('name')" type="text" class="text-input" />

      <div v-if="form.errors.name" class="text-red-500 text-sm mt-2">
        {{ form.errors.name }}
      </div>
    </div>

    <div>
      <label for="effect" class="block text-sm   text-gray-700 mb-2">
        Effect
      </label>

      <textarea v-bind="form.bind('effect')" rows="3" class="textarea" />

      <div v-if="form.errors.effect" class="text-red-500 text-sm mt-2">
        {{ form.errors.effect }}
      </div>
    </div>

    <div>
      <label for="category" class="block text-sm   text-gray-700 mb-2">
        Category
      </label>

      <select v-bind="form.bind('category')" class="select">
        <option value="">
          Select a category
        </option>

        <option v-for="category in SPELL_CATEGORIES" :key="category" :value="category">
          {{ category }}
        </option>
      </select>

      <div v-if="form.errors.category" class="text-red-500 text-sm mt-2">
        {{ form.errors.category }}
      </div>
    </div>

    <div>
      <label for="creator" class="block text-sm   text-gray-700 mb-2">
        Creator (optional)
      </label>

      <input v-bind="form.bind('creator')" id="creator" type="text" class="text-input" />

      <div v-if="form.errors.creator" class="text-red-500 text-sm mt-2">
        {{ form.errors.creator }}
      </div>
    </div>

    <div>
      <label for="image" class="block text-sm   text-gray-700 mb-2">
        Image Url (optional)
      </label>

      <input v-bind="form.bind('imageUrl')" id="image" type="url" class="text-input" />

      <div v-if="form.errors.imageUrl" class="text-red-500 text-sm mt-2">
        {{ form.errors.imageUrl }}
      </div>
    </div>

    <div>
      <label for="wiki" class="block text-sm   text-gray-700">
        Wiki Url (optional)
      </label>

      <input v-bind="form.bind('wikiUrl')" id="wiki" type="url" class="text-input" />

      <div v-if="form.errors.wikiUrl" class="text-red-500 text-sm mt-1">
        {{ form.errors.wikiUrl }}
      </div>
    </div>

    <div>
      <label for="light" class="block text-sm   text-gray-700 mb-2">
        Light (optional)
      </label>

      <select v-bind="form.bind('light')" id="light" class="select">
        <option value="">
          Select a color
        </option>

        <option v-for="color in LIGHT_COLORS" :key="color" :value="color">
          {{ color }}
        </option>
      </select>

      <div v-if="form.errors.light" class="text-red-500 text-sm mt-2">
        {{ form.errors.light }}
      </div>
    </div>

    <div class="flex flex-row">
      <button v-if="spell.id" type="button" class="a text-sm text-red-500 hover:text-red-600" @click="onDelete">
        Delete
      </button>

      <div class="flex ms-auto space-x-6 items-center">
        <NuxtLink :to="spell.id ? `/spells/${spell.id}` : '/'" class="a text-black text-sm">
          Cancel
        </NuxtLink>

        <button type="submit" class="button-primary" :disabled="form.isSubmitting.value">
          <span v-if="form.isSubmitting.value">
            Saving...
          </span>

          <span v-else>
            Save
          </span>
        </button>
      </div>
    </div>
  </form>
</template>
