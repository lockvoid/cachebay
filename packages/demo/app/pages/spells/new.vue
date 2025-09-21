<script setup>
  const settings = useSettings();
</script>

<template>
  <div class=" bg-gray-100 p-6">
    <ErrorBoundary>
      <Suspense v-if="settings.ssr">
        <SpellNew />

        <template #fallback>
          <SpellSkeleton />
        </template>
      </Suspense>

      <ClientOnly v-else>
         <Suspense>
           <SpellNew />

           <template #fallback>
             <SpellSkeleton />
           </template>
         </Suspense>
      </ClientOnly>
    </ErrorBoundary>
  </div>
</template>
