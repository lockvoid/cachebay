<template>
  <div class="flex flex-col gap-6">
    <SpellsHeader />

    <ErrorBoundary>
      <Suspense>
        <SpellsList />
      </Suspense>
    </ErrorBoundary>
  </div>
</template>
