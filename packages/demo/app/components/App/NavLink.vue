<script setup>
  defineOptions({
    inheritAttrs: false
  })
</script>

<template>
  <NuxtLink v-bind="$attrs" class="underline underline-offset-4 decoration-2 hover:decoration-4 hover:decoration-lego-yellow" active-class="decoration-4 decoration-lego-yellow">
    <slot />
  </NuxtLink>
</template>
