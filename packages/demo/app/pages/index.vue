<script setup>
  const settings = useSettings();
</script>

<template>
  <div class=" bg-gray-100 p-6">
    <ErrorBoundary>
      <Suspense v-if="settings.ssr">
        <SpellsList />

        <template #fallback>
          <SpellsSkeleton />
        </template>
      </Suspense>

      <ClientOnly v-else>
        <Suspense>
          <SpellsList />

          <template #fallback>
            <SpellsSkeleton />
          </template>
        </Suspense>
      </ClientOnly>
    </ErrorBoundary>
  </div>
</template>
