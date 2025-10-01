<script setup lang="ts">
  import { useForm } from "@lockvoid/vue-form";
  import * as v from "valibot";

  const SPELL_CATEGORIES = [
    "Charm",
    "Curse",
    "Enchantment",
    "Hex",
    "Jinx",
    "Spell",
    "Transfiguration",
  ];

  const LIGHT_COLORS = [
    "Blue",
    "Green",
    "Red",
    "Gold",
    "Silver",
    "White",
    "Black",
    "Purple",
    "Yellow",
    "Orange",
  ];

  // SpellForm type definition - using any to avoid parsing issues

  const props = defineProps({
    spell: {
      type: Object,
      required: true,
    },

    onSubmit: {
      type: Function,
      required: true,
    },

    onDelete: {
      type: Function,
      required: false,
      default: undefined,
    },
  });

  const emit = defineEmits(["success"]);

  const schema = v.pipe(
    v.object({
      name: v.pipe(v.string(), v.trim(), v.minLength(1, "Name is required")),
      effect: v.pipe(v.string(), v.trim(), v.minLength(1, "Effect is required")),
      category: v.pipe(v.string(), v.minLength(1, "Category is required")),
      creator: v.optional(v.string()),
      light: v.optional(v.string()),
      imageUrl: v.optional(v.string()),
      wikiUrl: v.optional(v.string()),
    }),
  );

  const form = useForm({
    schema,

    initialValues: props.spell,

    onSubmit: async (values) => {
      await props.onSubmit(values);

      emit("success");
    },
  });
</script>

<template>
  <form class="space-y-6" @submit.prevent="form.submit">
    <div>
      <label for="name" class="mb-2 block  text-sm text-gray-700">
        Spell
      </label>

      <input v-bind="form.bind('name')" type="text" class="text-input">

      <div v-if="form.errors.name" class="mt-2 text-sm text-red-500">
        {{ form.errors.name }}
      </div>
    </div>

    <div>
      <label for="effect" class="mb-2 block   text-sm text-gray-700">
        Effect
      </label>

      <textarea v-bind="form.bind('effect')" rows="3" class="textarea" />

      <div v-if="form.errors.effect" class="mt-2 text-sm text-red-500">
        {{ form.errors.effect }}
      </div>
    </div>

    <div>
      <label for="category" class="mb-2 block   text-sm text-gray-700">
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

      <div v-if="form.errors.category" class="mt-2 text-sm text-red-500">
        {{ form.errors.category }}
      </div>
    </div>

    <div>
      <label for="creator" class="mb-2 block   text-sm text-gray-700">
        Creator (optional)
      </label>

      <input v-bind="form.bind('creator')" id="creator" type="text" class="text-input">

      <div v-if="form.errors.creator" class="mt-2 text-sm text-red-500">
        {{ form.errors.creator }}
      </div>
    </div>

    <div>
      <label for="image" class="mb-2 block   text-sm text-gray-700">
        Image Url (optional)
      </label>

      <input v-bind="form.bind('imageUrl')" id="image" type="url" class="text-input">

      <div v-if="form.errors.imageUrl" class="mt-2 text-sm text-red-500">
        {{ form.errors.imageUrl }}
      </div>
    </div>

    <div>
      <label for="wiki" class="block text-sm   text-gray-700">
        Wiki Url (optional)
      </label>

      <input v-bind="form.bind('wikiUrl')" id="wiki" type="url" class="text-input">

      <div v-if="form.errors.wikiUrl" class="mt-1 text-sm text-red-500">
        {{ form.errors.wikiUrl }}
      </div>
    </div>

    <div>
      <label for="light" class="mb-2 block   text-sm text-gray-700">
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

      <div v-if="form.errors.light" class="mt-2 text-sm text-red-500">
        {{ form.errors.light }}
      </div>
    </div>

    <div class="flex flex-row">
      <button v-if="spell.id" type="button" class="a text-sm text-red-500 hover:text-red-600" @click="onDelete">
        Delete
      </button>

      <div class="ms-auto flex items-center space-x-6">
        <NuxtLink :to="spell.id ? `/spells/${spell.id}` : '/'" class="a text-sm text-black">
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
