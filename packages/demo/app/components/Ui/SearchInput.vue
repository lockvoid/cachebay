<script setup>
  defineOptions({
    inheritAttrs: false,
  });

  const model = defineModel();
</script>

<template>
  <input v-bind="$attrs" v-model="model" type="text" placeholder="Search..." class="w-full rounded-full border-2 border-gray-300 px-3 py-2 font-serif focus:border-blue-500 focus:outline-none" autofocus>
</template>
