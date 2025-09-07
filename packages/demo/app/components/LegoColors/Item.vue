<script setup lang="ts">
  const props = defineProps({
    color: {
      type: Object,
      required: true,
    }
  });
</script>

<template>
  <li class="border rounded p-3 flex items-center gap-3">
    <div class="h-8 w-8 rounded border" :style="{ backgroundColor: '#' + color.rgb }" />
    
    <div class="min-w-0">
      <div class="font-medium truncate">
        {{ color.name }}
      </div>

      <div class="text-xs text-gray-500">
        #{{ color.rgb }}
      </div>
    </div>
  </li>
</template>
