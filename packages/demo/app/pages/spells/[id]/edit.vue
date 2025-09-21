<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useSpellQuery } from '~/composables/useSpellQuery';
import { useUpdateSpell } from '~/composables/useUpdateSpell';
import { useDeleteSpell } from '~/composables/useDeleteSpell';

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

interface SpellForm {
  name: string;
  incantation: string;
  effect: string;
  type: string;
  light: string;
}

const route = useRoute();
const router = useRouter();
const id = computed(() => route.params.id as string);
const loading = ref(false);

const { data, isFetching, error } = useSpellQuery(id);

const spell = computed<Spell | null>(() => data.value?.spell || null);

const updateSpell = useUpdateSpell();
const deleteSpell = useDeleteSpell();

const handleSubmit = async (formData: SpellForm) => {
  try {
    loading.value = true;
    const result = await updateSpell.execute({
      id: id.value,
      input: formData
    });

    if (result.error) {
      console.error('Error updating spell:', result.error);
      return;
    }

    // Redirect to view page after successful update
    await router.push(`/spells/${id.value}`);
  } catch (err) {
    console.error('Unexpected error:', err);
  } finally {
    loading.value = false;
  }
};

const handleDelete = async () => {
  if (!confirm('Are you sure you want to delete this spell? This action cannot be undone.')) return;
  
  try {
    loading.value = true;
    const result = await deleteSpell.execute({
      id: id.value
    });

    if (result.error) {
      console.error('Error deleting spell:', result.error);
      return;
    }

    // Redirect to spells list after successful deletion
    await router.push('/spells');
  } catch (err) {
    console.error('Unexpected error:', err);
  } finally {
    loading.value = false;
  }
};
</script>

<template>
  <div class="min-h-screen bg-gray-100 py-8">
    <div class="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
      <div class="bg-white shadow overflow-hidden sm:rounded-lg">
        <!-- Header -->
        <div class="px-4 py-5 border-b border-gray-200 sm:px-6">
          <div class="flex items-center justify-between">
            <div>
              <h3 class="text-lg font-medium leading-6 text-gray-900">
                Edit Spell
              </h3>
              <p class="mt-1 text-sm text-gray-500">
                Update the details of this magical spell.
              </p>
            </div>
            <NuxtLink 
              :to="`/spells/${id}`"
              class="inline-flex items-center px-3 py-1.5 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
            >
              Cancel
            </NuxtLink>
          </div>
        </div>
        
        <!-- Loading State -->
        <div v-if="isFetching" class="p-6 space-y-4">
          <div class="h-8 bg-gray-200 rounded w-1/3"></div>
          <div class="h-4 bg-gray-200 rounded w-1/4"></div>
          <div class="h-4 bg-gray-200 rounded w-1/2"></div>
        </div>
        
        <!-- Error State -->
        <div v-else-if="error" class="p-6">
          <div class="bg-red-50 border-l-4 border-red-400 p-4">
            <div class="flex">
              <div class="flex-shrink-0">
                <svg class="h-5 w-5 text-red-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd" />
                </svg>
              </div>
              <div class="ml-3">
                <p class="text-sm text-red-700">
                  Failed to load spell. Please try again.
                </p>
              </div>
            </div>
          </div>
        </div>
        
        <!-- Edit Form -->
        <div v-else-if="spell">
          <div class="px-4 py-5 sm:p-6">
            <SpellForm 
              :spell="{
                name: spell.name || '',
                incantation: '',
                effect: spell.effect || '',
                type: spell.category || '',
                light: spell.light || ''
              }"
              :loading="isFetching || loading"
              @submit="handleSubmit"
              @delete="handleDelete"
            />
          </div>
        </div>
        
        <div v-else class="p-6 text-center text-gray-600">
          Spell not found.
        </div>
      </div>
      
      <div class="mt-6">
        <NuxtLink 
          :to="spell ? `/spells/${spell.id}` : '/spells'" 
          class="inline-flex items-center text-sm font-medium text-blue-600 hover:text-blue-500"
        >
          <svg class="mr-1 h-5 w-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clip-rule="evenodd" />
          </svg>
          Back to {{ spell ? 'Spell' : 'Spells' }}
        </NuxtLink>
      </div>
    </div>
  </div>
</template>
