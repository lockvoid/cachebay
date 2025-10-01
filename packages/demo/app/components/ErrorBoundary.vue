<script setup>
  const capturedError = ref(null);

  onErrorCaptured(error => {
    capturedError.value = error;

    console.log(error);

    return false;
  });
</script>

<template>
  <div v-if="capturedError" class="flex flex-1 flex-col items-center justify-center">
    Could not load. Please try again.

    <div>{{ capturedError.message }}</div>
  </div>

  <slot />
</template>
