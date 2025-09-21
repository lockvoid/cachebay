<script setup>
defineOptions({
  inheritAttrs: false
});

const model = defineModel();
</script>

<template>
  <input
    v-bind="$attrs"
    v-model="model"
    type="text"
    placeholder="Search"
    class="font-serif w-full border-gray-300 border-2 px-3 py-2 rounded-full focus:outline-none focus:border-blue-500"
    autofocus
  />
</template>
