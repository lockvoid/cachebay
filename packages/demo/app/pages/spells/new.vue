<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useCreateSpell } from '~/composables/useCreateSpell';

interface SpellForm {
  name: string;
  incantation: string;
  effect: string;
  type: string;
  light: string;
}

const router = useRouter();
const loading = ref(false);

const createSpell = useCreateSpell();

const handleSubmit = async (formData: SpellForm) => {
  try {
    loading.value = true;
    const result = await createSpell.execute({
      input: formData
    });

    if (result.error) {
      console.error('Error creating spell:', result.error);
      return;
    }

    await router.push('/spells');
  } catch (err) {
    console.error('Unexpected error:', err);
  } finally {
    loading.value = false;
  }
};
</script>

<template>
  <div class="max-w-3xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
    <div class="bg-white shadow overflow-hidden sm:rounded-lg">
      <div class="px-4 py-5 sm:px-6 border-b border-gray-200">
        <h3 class="text-lg leading-6 font-medium text-gray-900">New spell</h3>
        <p class="mt-1 max-w-2xl text-sm text-gray-500">Fill in the details below to add a new spell to the spellbook.</p>
      </div>
      <div class="px-4 py-5 sm:p-6">
        <SpellForm :spell="{ name: '', incantation: '', effect: '', type: '', light: '' }" :loading="loading" @submit="handleSubmit" />
      </div>
    </div>
  </div>
</template>
