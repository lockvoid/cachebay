<template>
  <div class="flex flex-col gap-6">
    <LegoColorsHeader />

    <ErrorBoundary>
      <Suspense>
        <LegoColorsList />
      </Suspense>
    </ErrorBoundary>
  </div>
</template>
