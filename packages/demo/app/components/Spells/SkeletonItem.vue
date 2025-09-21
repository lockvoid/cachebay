<script setup>
  defineOptions({
    inheritAttrs: false
  });
</script>

<template>
  <li v-bind="$attrs" class="flex">
    <div class="flex flex-col w-full">
      <div class="relative w-full aspect-square overflow-hidden rounded-lg bg-gray-200" />

      <div class="mt-3 text-center">
        <div class="h-4 w-3/4 bg-gray-200 rounded mx-auto" />
        <div class="h-3 w-1/2 bg-gray-200 rounded mx-auto mt-3" />
      </div>
    </div>
  </li>
</template>
