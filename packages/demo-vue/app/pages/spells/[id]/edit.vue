<script setup>
  const route = useRoute();

  const settings = useSettings();
</script>

<template>
  <div class=" bg-gray-100 p-6">
    <ErrorBoundary>
      <Suspense v-if="settings.ssr">
        <SpellEdit :spell-id="route.params.id" />

        <template #fallback>
          <SpellSkeleton />
        </template>
      </Suspense>

      <ClientOnly v-else>
        <Suspense>
          <SpellEdit :spell-id="route.params.id" />

          <template #fallback>
            <SpellSkeleton />
          </template>
        </Suspense>
      </ClientOnly>
    </ErrorBoundary>
  </div>
</template>
