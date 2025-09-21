<script setup>
  const settings = useSettings();
</script>

<template>
  <div class="flex flex-col gap-6">
    <SpellsHeader />

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
