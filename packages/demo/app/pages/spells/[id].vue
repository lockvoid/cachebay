<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useSpellQuery } from '~/composables/useSpellQuery';

interface Spell {
  id: string;
  name: string;
  slug: string;
  category: string;
  creator: string;
  effect: string;
  image: string;
  light: string;
  wiki: string;
}

const route = useRoute();
const id = computed(() => route.params.id as string);

const { data, isFetching, error } = await useSpellQuery(id);

const spell = computed(() => data?.value?.spell);
</script>

<template>
  <div class="min-h-screen bg-gray-100 py-6">
    <div class="max-w-3xl mx-auto space-y-6">
      <NuxtLink to="/" class="inline-flex items-center text-sm font-medium text-blue-600 hover:text-blue-500">
        ← Back to Spells
      </NuxtLink>

      <div class="bg-white shadow overflow-hidden sm:rounded-lg">
        <SpellDetail :spell="spell" :show-edit-button="true" />
      </div>
    </div>
  </div>
</template>
