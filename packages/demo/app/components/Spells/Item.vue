<script setup lang="ts">
  const props = defineProps({
    spell: {
      type: Object,
      required: true,
    }
  });

  // Generate magic gradient from light field colors
  const getMagicGradient = (light: string) => {
    if (!light) return 'bg-gradient-to-br from-gray-100 to-gray-200';
    
    const colors = light.split(',').map(color => color.trim().toLowerCase());
    const colorMap: Record<string, string> = {
      red: 'from-red-200 to-red-300',
      green: 'from-green-200 to-green-300', 
      blue: 'from-blue-200 to-blue-300',
      yellow: 'from-yellow-200 to-yellow-300',
      purple: 'from-purple-200 to-purple-300',
      pink: 'from-pink-200 to-pink-300',
      orange: 'from-orange-200 to-orange-300',
      cyan: 'from-cyan-200 to-cyan-300',
      indigo: 'from-indigo-200 to-indigo-300',
      violet: 'from-violet-200 to-violet-300'
    };
    
    // Use first recognized color or default
    const firstColor = colors.find(color => colorMap[color]);
    return firstColor ? `bg-gradient-to-br ${colorMap[firstColor]}` : 'bg-gradient-to-br from-gray-100 to-gray-200';
  };
</script>

<template>
  <li class="group">
    <NuxtLink :to="`/spells/${props.spell.id}`" class="block">
      <!-- Image -->
      <div class="relative w-full aspect-square overflow-hidden rounded-lg group-hover:opacity-90 transition">
        <img
          v-if="props.spell.image"
          :src="props.spell.image"
          :alt="props.spell.name"
          class="w-full h-full object-cover"
        />
        <div v-else class="w-full h-full flex items-center justify-center" :class="getMagicGradient(props.spell.light)">
          <span class="text-white text-2xl drop-shadow-sm">✨</span>
        </div>
      </div>

      <!-- Meta -->
      <div class="mt-3 text-center">
        <h3 class="text-sm font-semibold text-gray-900">{{ props.spell.name }}</h3>
        <p class="text-xs text-gray-600 mt-1">{{ props.spell.category }}</p>
      </div>
    </NuxtLink>
  </li>
</template>
