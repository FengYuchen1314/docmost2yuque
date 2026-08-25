export interface EditorOperationErrors {
  load: string
  save: string
}

export function editorErrorMessage(errors: EditorOperationErrors) {
  return errors.load || errors.save
}

export function clearSuccessfulSaveError(errors: EditorOperationErrors) {
  errors.save = ''
}
