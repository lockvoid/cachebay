<script setup>
  const settings = useSettings();
</script>

<template>
  <div class="min-h-screen bg-gray-50 p-6">
    <ErrorBoundary>
      <Suspense>
        <SpellsList v-if="settings.ssr" />

        <ClientOnly v-else fallback="Loading...">
          <SpellsList />
        </ClientOnly>
      </Suspense>
    </ErrorBoundary>
  </div>
</template>
