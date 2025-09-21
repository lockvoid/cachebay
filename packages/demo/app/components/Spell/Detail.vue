<script setup lang="ts">
const props = defineProps({
  spell: {
    type: Object,
    required: true,
  },
  showEditButton: {
    type: Boolean,
    default: false,
  }
});
</script>

<template>
  <div class="px-4 py-5 sm:p-6">
    <!-- Spell Image -->
    <div v-if="spell.image" class="mb-6">
      <img :src="spell.image":alt="spell.name" class="w-full h-64 object-cover rounded-lg" />
    </div>

    <div class="flex justify-between items-start">
      <div>
        <h2 class="text-2xl font-bold text-gray-900">
          {{ spell.name }}
        </h2>

        <p class="mt-1 text-sm text-gray-500">
          {{ spell.effect }}
        </p>
      </div>

      <NuxtLink
        v-if="showEditButton"
        :to="`/spells/${spell.id}/edit`"
        class="button-primary"
      >
        Edit Spell
      </NuxtLink>
    </div>

    <div class="mt-6 border-t border-gray-200 pt-6">
      <dl class="space-y-6">
        <div v-if="spell.creator" >
          <dt class="text-sm font-medium text-gray-500">
            Creator
          </dt>

          <dd class="mt-1 text-sm text-gray-900">
            {{ spell.creator }}
          </dd>
        </div>

        <div v-if="spell.category" >
          <dt class="text-sm font-medium text-gray-500">
            Category
          </dt>

          <dd class="mt-1 text-sm text-gray-900">
            {{ spell.category }}
          </dd>
        </div>

        <div v-if="spell.light" class="text-sm gap-1">
          <dt class="text-sm font-medium text-gray-500">
            Light
          </dt>

          <dd class="text-sm text-gray-900">
            {{ spell.light.split(',').map(item => titleCase(item)).join(', ') }}
          </dd>
        </div>

        <div v-if="spell.wiki" class="text-sm gap-1">
          <dt class="text-sm font-medium text-gray-500">
            Wiki Reference
          </dt>

          <dd class="mt-1">
            <a :href="spell.wiki" target="_blank" class="text-blue-600 hover:text-blue-500">
              Learn more →
            </a>
          </dd>
        </div>
      </dl>
    </div>
  </div>
</template>
