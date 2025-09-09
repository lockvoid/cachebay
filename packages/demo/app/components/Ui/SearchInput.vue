<script setup>
  defineOptions({
    inheritAttrs: false
  })

  const model = defineModel()
</script>

<template>
  <input v-bind="$attrs" v-model="model" type="text" placeholder="Search" class="w-1/4 border-gray-300 border-2 px-3 py-2 rounded-full border focus:outline-none  focus:border-blue-500" />
</template>
