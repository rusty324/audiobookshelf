<template>
  <div>
    <app-settings-content :header-text="$strings.HeaderLibraries">
      <template #header-items>
        <ui-tooltip :text="$strings.LabelClickForMoreInfo" class="inline-flex ml-2">
          <a href="https://audiobookshelf.org/docs/documentation/libraries/common-content/overview" target="_blank" class="inline-flex">
            <span class="material-symbols text-xl w-5 text-gray-200">help_outline</span>
          </a>
        </ui-tooltip>

        <div class="grow" />

        <ui-btn color="bg-primary" small :loading="exporting" class="mr-2" @click="exportBooksJson">{{ $strings.ButtonExportBooksJson }}</ui-btn>

        <ui-btn color="bg-primary" small @click="setShowLibraryModal()">{{ $strings.ButtonAddLibrary }}</ui-btn>
      </template>
      <tables-library-libraries-table @showLibraryModal="setShowLibraryModal" class="pt-2" />
    </app-settings-content>
    <modals-libraries-edit-modal v-model="showLibraryModal" :library="selectedLibrary" />
  </div>
</template>

<script>
export default {
  asyncData({ store, redirect }) {
    if (!store.getters['user/getIsAdminOrUp']) {
      redirect('/')
    }
  },
  data() {
    return {
      exporting: false,
      showLibraryModal: false,
      selectedLibrary: null
    }
  },
  computed: {},
  methods: {
    /**
     * Download a JSON listing of every book across all accessible book libraries.
     */
    async exportBooksJson() {
      this.exporting = true

      const entries = await this.$axios.$get('/api/libraries/books-export').catch((error) => {
        console.error('Failed to export books', error)
        return null
      })

      this.exporting = false
      if (!entries) {
        this.$toast.error(this.$strings.ToastExportBooksFailed)
        return
      }

      const blob = new Blob([JSON.stringify(entries, null, 2)], { type: 'application/json' })
      const blobUrl = URL.createObjectURL(blob)
      this.$downloadFile(blobUrl, 'audiobookshelf-books.json')
      // Release the object URL once the download has been handed off
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000)
    },
    setShowLibraryModal(selectedLibrary) {
      this.selectedLibrary = selectedLibrary
      this.showLibraryModal = true
    }
  },
  mounted() {}
}
</script>
