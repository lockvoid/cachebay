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
        <div v-else-if="spell" class="px-4 py-5 sm:p-6">
          <div class="flex justify-between items-start">
            <div>
              <h2 class="text-2xl font-bold text-gray-900">{{ spell.name }}</h2>
              <p class="mt-1 text-sm text-gray-500">
                {{ spell.category }} • {{ spell.light }}
              </p>
            </div>
            <NuxtLink 
              :to="`/spells/${spell.id}/edit`"
              class="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Edit Spell
            </NuxtLink>
          </div>
          
          <div class="mt-6 border-t border-gray-200 pt-6">
            <dl class="space-y-6">
              <div>
                <dt class="text-sm font-medium text-gray-500">Effect</dt>
                <dd class="mt-1 text-sm text-gray-900">{{ spell.effect }}</dd>
              </div>
              
              <div class="flex space-x-4 text-sm">
                <div>
                  <dt class="font-medium text-gray-500">Category</dt>
                  <dd class="mt-1 text-gray-900">{{ spell.category || '—' }}</dd>
                </div>
                <div>
                  <dt class="font-medium text-gray-500">Light</dt>
                  <dd class="mt-1 text-gray-900">{{ spell.light || '—' }}</dd>
                </div>
              </div>
              
              <div v-if="spell.creator" class="text-sm">
                <dt class="font-medium text-gray-500">Creator</dt>
                <dd class="mt-1 text-gray-900">{{ spell.creator }}</dd>
              </div>
              
              <div v-if="spell.wiki" class="text-sm">
                <dt class="font-medium text-gray-500">Wiki Reference</dt>
                <dd class="mt-1">
                  <a :href="spell.wiki" target="_blank" class="text-blue-600 hover:text-blue-500">
                    Learn more
                  </a>
                </dd>
              </div>
            </dl>
          </div>
        </div>
        
        <div v-else class="p-6 text-center text-gray-600">
          Spell not found.
        </div>
      </div>
      
      <div class="mt-6">
        <NuxtLink 
          to="/spells" 
          class="inline-flex items-center text-sm font-medium text-blue-600 hover:text-blue-500"
        >
          <svg class="mr-1 h-5 w-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clip-rule="evenodd" />
          </svg>
          Back to Spells
        </NuxtLink>
      </div>
    </div>
  </div>
</template>
