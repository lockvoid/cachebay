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

const { data, isFetching, error } = useSpellQuery(id);

const spell = computed(() => data?.value?.spell);
</script>

<template>
  <div class="min-h-screen bg-gray-100 py-8">
    <div class="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="bg-white shadow overflow-hidden sm:rounded-lg">
        <!-- Loading State -->
        <div v-if="isFetching" class="p-6 space-y-4">
          <div class="h-8 bg-gray-200 rounded w-1/3"></div>
          <div class="h-4 bg-gray-200 rounded w-1/4"></div>
          <div class="h-4 bg-gray-200 rounded w-1/2"></div>
        </div>

        <!-- Spell Details -->
        <div v-else-if="spell">
          <SpellDetail :spell="spell" :show-edit-button="true" />
        </div>

        <div v-else class="p-6 text-center text-gray-600">
          Spell not found.
        </div>
      </div>

      <div class="mt-6">
        <NuxtLink to="/" class="inline-flex items-center text-sm font-medium text-blue-600 hover:text-blue-500">
          Back to Spells
        </NuxtLink>
      </div>
    </div>
  </div>
</template>
