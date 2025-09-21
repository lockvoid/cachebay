<script setup lang="ts">
const props = defineProps({
  colors: {
    type: String,
    default: ''
  },
  size: {
    type: String,
    default: 'text-2xl'
  }
});

// Generate magic gradient from light field colors
const getMagicGradient = (light: string) => {
  if (!light) return 'bg-gradient-to-br from-gray-100 to-gray-200';
  
  const colors = light.split(',').map(color => color.trim().toLowerCase());
  const colorMap: Record<string, string> = {
    blue: 'from-blue-200 to-blue-400',
    red: 'from-red-200 to-red-400',
    white: 'from-gray-100 to-gray-300',
    gold: 'from-yellow-200 to-yellow-400',
    purple: 'from-purple-200 to-purple-400',
    orange: 'from-orange-200 to-orange-400',
    yellow: 'from-yellow-200 to-yellow-400',
    pink: 'from-pink-200 to-pink-400',
    green: 'from-green-200 to-green-400',
    grey: 'from-gray-200 to-gray-400',
    gray: 'from-gray-200 to-gray-400'
  };
  
  // Use first recognized color or default
  const firstColor = colors.find(color => colorMap[color]);
  return firstColor ? `bg-gradient-to-br ${colorMap[firstColor]}` : 'bg-gradient-to-br from-gray-100 to-gray-200';
};
</script>

<template>
  <div class="w-full h-full flex items-center justify-center" :class="getMagicGradient(props.colors)">
    <span class="text-white drop-shadow-sm" :class="props.size">✨</span>
  </div>
</template>
