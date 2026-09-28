<template>
  <div v-if="show" class="w-full px-4e sm:px-8e py-8e">
    <div class="flex items-center mb-4e">
      <p class="text-1.2e font-semibold">{{ $strings.HeaderNotInLibrary }}</p>
      <div class="w-6e" />
      <p v-if="placeholders.length" class="text-0.9e text-gray-400">{{ placeholders.length }}</p>
      <div class="grow" />
      <ui-btn v-if="canUpdate && hardcoverEnabled && !showAddForm && !suggestions.length" small color="bg-primary" class="mr-2e" :loading="loadingSuggestions" @click="findMissingBooks">{{ $strings.ButtonFindMissingBooks }}</ui-btn>
      <ui-btn v-if="canUpdate && !showAddForm" small color="bg-primary" @click="showAddForm = true">{{ $strings.ButtonAddMissingBook }}</ui-btn>
    </div>

    <p class="text-0.85e text-gray-400 mb-4e">{{ $strings.MessageSeriesPlaceholdersHelp }}</p>

    <!-- Add / edit form -->
    <div v-if="showAddForm" class="w-full bg-primary/40 border border-white/10 rounded p-4e mb-4e">
      <div class="flex flex-wrap -mx-1e">
        <div class="px-1e w-full sm:w-1/2 mb-2e">
          <ui-text-input-with-label ref="titleInput" v-model="form.title" :label="$strings.LabelTitle" />
        </div>
        <div class="px-1e w-1/2 sm:w-1/4 mb-2e">
          <ui-text-input-with-label v-model="form.sequence" :label="$strings.LabelSequence" />
        </div>
        <div class="px-1e w-1/2 sm:w-1/4 mb-2e">
          <ui-text-input-with-label v-model="form.authorName" :label="$strings.LabelAuthor" />
        </div>
      </div>
      <div class="flex justify-end items-center pt-2e">
        <ui-btn small color="bg-primary" class="mr-2e" @click="cancelForm">{{ $strings.ButtonCancel }}</ui-btn>
        <ui-btn small color="bg-success" :loading="saving" @click="submitForm">{{ $strings.ButtonSave }}</ui-btn>
      </div>
    </div>

    <!-- Hardcover suggestions, pending confirmation. Nothing is saved until
         the user picks; the data is third-party and imperfect. -->
    <div v-if="suggestions.length" class="w-full bg-primary/40 border border-white/10 rounded p-4e mb-4e">
      <div class="flex items-center mb-2e">
        <p class="text-1e font-semibold">{{ $getString('HeaderSuggestedFromHardcover', [matchedSeriesName]) }}</p>
        <div class="grow" />
        <ui-btn small color="bg-primary" @click="toggleSelectAll">{{ allSelected ? $strings.ButtonDeselectAll : $strings.ButtonSelectAll }}</ui-btn>
      </div>
      <p class="text-0.8e text-gray-400 mb-3e">{{ seriesCompletenessMessage }}</p>

      <div v-for="(suggestion, index) in suggestions" :key="suggestion.sourceId || index" class="flex items-center py-1e">
        <ui-checkbox v-model="selected[index]" :label="suggestion.title" checkbox-bg="primary" small label-class="pl-2e text-0.9e" />
        <div class="grow" />
        <p v-if="suggestion.sequence" class="text-0.8e font-mono text-gray-400 px-2e">#{{ suggestion.sequence }}</p>
        <p v-if="suggestion.releaseYear" class="text-0.75e text-gray-500">{{ suggestion.releaseYear }}</p>
      </div>

      <div class="flex justify-end items-center pt-3e">
        <ui-btn small color="bg-primary" class="mr-2e" @click="dismissSuggestions">{{ $strings.ButtonCancel }}</ui-btn>
        <ui-btn small color="bg-success" :loading="addingSuggestions" :disabled="!selectedCount" @click="addSelectedSuggestions">{{ $getString('ButtonAddSelectedCount', [selectedCount]) }}</ui-btn>
      </div>
    </div>

    <p v-if="!placeholders.length && !showAddForm && !suggestions.length" class="text-0.9e text-gray-400 italic">{{ $strings.MessageNoSeriesPlaceholders }}</p>

    <!-- Ghost entries -->
    <div v-for="placeholder in placeholders" :key="placeholder.id" class="flex items-center w-full border border-dashed border-white/20 rounded px-3e py-2e mb-2e opacity-60 hover:opacity-90 transition-opacity">
      <div class="w-8e text-center shrink-0">
        <p v-if="placeholder.sequence" class="text-0.9e font-mono">#{{ placeholder.sequence }}</p>
        <span v-else class="material-symbols text-1.1e text-gray-500">help_outline</span>
      </div>
      <div class="grow px-2e min-w-0">
        <p class="text-1e truncate">{{ placeholder.title }}</p>
        <p v-if="placeholder.authorName" class="text-0.8e text-gray-400 truncate">{{ placeholder.authorName }}</p>
      </div>
      <p class="text-0.75e text-gray-400 uppercase tracking-wide shrink-0 px-2e hidden sm:block">{{ $strings.LabelNotInLibrary }}</p>
      <div v-if="canUpdate" class="flex items-center shrink-0">
        <ui-tooltip :text="$strings.LabelPromoteToLibraryItem">
          <ui-icon-btn icon="library_add" borderless :size="7" icon-font-size="1.1rem" :aria-label="$strings.LabelPromoteToLibraryItem" @click="promotePlaceholder(placeholder)" />
        </ui-tooltip>
        <ui-icon-btn icon="edit" borderless :size="7" icon-font-size="1.1rem" :aria-label="$strings.ButtonEdit" @click="editPlaceholder(placeholder)" />
        <ui-icon-btn icon="close" borderless :size="7" icon-font-size="1.1rem" :aria-label="$strings.ButtonRemove" @click="removePlaceholder(placeholder)" />
      </div>
    </div>
  </div>
</template>

<script>
export default {
  props: {
    seriesId: String
  },
  data() {
    return {
      placeholders: [],
      loaded: false,
      saving: false,
      showAddForm: false,
      editingId: null,
      loadingSuggestions: false,
      addingSuggestions: false,
      suggestions: [],
      selected: [],
      matchedSeriesName: '',
      seriesIsCompleted: false,
      form: {
        title: '',
        sequence: '',
        authorName: ''
      }
    }
  },
  computed: {
    canUpdate() {
      return this.$store.getters['user/getUserCanUpdate']
    },
    show() {
      // Stay out of the way until there is something to show or something to do
      return this.loaded && (this.placeholders.length > 0 || this.canUpdate)
    },
    hardcoverEnabled() {
      return !!this.$store.state.serverSettings?.hardcoverEnabled
    },
    selectedCount() {
      return this.selected.filter(Boolean).length
    },
    allSelected() {
      return this.suggestions.length > 0 && this.selectedCount === this.suggestions.length
    },
    seriesCompletenessMessage() {
      // Whether the series is finished decides if this list can be trusted as
      // the whole story or only what exists so far
      return this.seriesIsCompleted ? this.$strings.MessageHardcoverSeriesComplete : this.$strings.MessageHardcoverSeriesOngoing
    }
  },
  methods: {
    async loadPlaceholders() {
      if (!this.seriesId) return
      const data = await this.$axios.$get(`/api/series/${this.seriesId}/placeholders`).catch((error) => {
        console.error('Failed to load series placeholders', error)
        return null
      })
      this.placeholders = data?.placeholders || []
      this.loaded = true
    },
    resetForm() {
      this.form.title = ''
      this.form.sequence = ''
      this.form.authorName = ''
      this.editingId = null
    },
    cancelForm() {
      this.showAddForm = false
      this.resetForm()
    },
    editPlaceholder(placeholder) {
      this.editingId = placeholder.id
      this.form.title = placeholder.title
      this.form.sequence = placeholder.sequence || ''
      this.form.authorName = placeholder.authorName || ''
      this.showAddForm = true
    },
    async submitForm() {
      const title = (this.form.title || '').trim()
      if (!title) {
        this.$toast.error(this.$strings.ToastTitleRequired)
        return
      }
      this.saving = true
      const payload = {
        title,
        sequence: (this.form.sequence || '').trim(),
        authorName: (this.form.authorName || '').trim()
      }
      const request = this.editingId ? this.$axios.$patch(`/api/series/${this.seriesId}/placeholders/${this.editingId}`, payload) : this.$axios.$post(`/api/series/${this.seriesId}/placeholders`, payload)

      const result = await request.catch((error) => {
        // 409 carries a specific reason worth showing rather than a generic failure
        const message = error.response?.status === 409 ? error.response.data : this.$strings.ToastSeriesPlaceholderFailed
        this.$toast.error(message || this.$strings.ToastSeriesPlaceholderFailed)
        return null
      })
      this.saving = false
      if (!result) return

      this.cancelForm()
      await this.loadPlaceholders()
    },
    async findMissingBooks() {
      this.loadingSuggestions = true
      const data = await this.$axios.$get(`/api/series/${this.seriesId}/placeholder-suggestions`).catch((error) => {
        const status = error.response?.status
        // 502 means Hardcover was reachable-but-unhelpful (no match, or an
        // API error); worth distinguishing from a local failure
        this.$toast.error(status === 502 ? this.$strings.ToastHardcoverLookupFailed : error.response?.data || this.$strings.ToastHardcoverLookupFailed)
        return null
      })
      this.loadingSuggestions = false
      if (!data) return

      this.suggestions = data.suggestions || []
      this.matchedSeriesName = data.matchedSeriesName || ''
      this.seriesIsCompleted = !!data.isCompleted
      this.selected = this.suggestions.map(() => true)

      if (!this.suggestions.length) {
        this.$toast.success(this.$strings.ToastHardcoverNoMissingBooks)
      }
    },
    toggleSelectAll() {
      const next = !this.allSelected
      this.selected = this.suggestions.map(() => next)
    },
    dismissSuggestions() {
      this.suggestions = []
      this.selected = []
      this.matchedSeriesName = ''
      this.seriesIsCompleted = false
    },
    async addSelectedSuggestions() {
      const chosen = this.suggestions.filter((_, index) => this.selected[index])
      if (!chosen.length) return

      this.addingSuggestions = true
      const result = await this.$axios
        .$post(`/api/series/${this.seriesId}/placeholders/bulk`, {
          placeholders: chosen.map((suggestion) => ({
            title: suggestion.title,
            subtitle: suggestion.subtitle,
            sequence: suggestion.sequence,
            authorName: suggestion.authorName,
            source: 'hardcover'
          }))
        })
        .catch((error) => {
          console.error('Failed to add suggested placeholders', error)
          this.$toast.error(this.$strings.ToastSeriesPlaceholderFailed)
          return null
        })
      this.addingSuggestions = false
      if (!result) return

      // Skipped entries are not an error - they are ones the library already
      // covers - but saying nothing would look like the request half failed
      if (result.skipped) {
        this.$toast.success(this.$getString('ToastSeriesPlaceholdersAddedSomeSkipped', [result.added, result.skipped]))
      } else {
        this.$toast.success(this.$getString('ToastSeriesPlaceholdersAdded', [result.added]))
      }

      this.dismissSuggestions()
      await this.loadPlaceholders()
    },
    async promotePlaceholder(placeholder) {
      const payload = {
        message: this.$getString('MessageConfirmPromotePlaceholder', [placeholder.title]),
        callback: async (confirmed) => {
          if (!confirmed) return
          const result = await this.$axios.$post(`/api/series/${this.seriesId}/placeholders/${placeholder.id}/promote`).catch((error) => {
            const message = error.response?.status === 409 ? error.response.data : this.$strings.ToastPromotePlaceholderFailed
            this.$toast.error(message || this.$strings.ToastPromotePlaceholderFailed)
            return null
          })
          if (!result) return
          this.$toast.success(this.$strings.ToastPlaceholderPromoted)
          await this.loadPlaceholders()
          // The grid above picks the new book up from the server's 'item_added'
          // socket event, the same path the scanner uses
        },
        type: 'yesNo'
      }
      this.$store.commit('globals/setConfirmPrompt', payload)
    },
    async removePlaceholder(placeholder) {
      const payload = {
        message: this.$getString('MessageConfirmRemoveSeriesPlaceholder', [placeholder.title]),
        callback: async (confirmed) => {
          if (!confirmed) return
          const success = await this.$axios
            .$delete(`/api/series/${this.seriesId}/placeholders/${placeholder.id}`)
            .then(() => true)
            .catch((error) => {
              console.error('Failed to remove series placeholder', error)
              this.$toast.error(this.$strings.ToastSeriesPlaceholderFailed)
              return false
            })
          if (success) await this.loadPlaceholders()
        },
        type: 'yesNo'
      }
      this.$store.commit('globals/setConfirmPrompt', payload)
    }
  },
  mounted() {
    this.loadPlaceholders()
  },
  watch: {
    seriesId() {
      this.loaded = false
      this.placeholders = []
      this.cancelForm()
      this.dismissSuggestions()
      this.loadPlaceholders()
    }
  }
}
</script>
