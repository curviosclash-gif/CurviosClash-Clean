export function renderProfileSelectOptions(selectElement, controlState) {
    if (!selectElement || !controlState) return;

    selectElement.innerHTML = '';

    const placeholder = document.createElement('option');
    placeholder.value = controlState.placeholderOption.value;
    placeholder.textContent = controlState.placeholderOption.text;
    selectElement.appendChild(placeholder);

    for (const optionData of controlState.profileOptions) {
        const option = document.createElement('option');
        option.value = optionData.value;
        option.textContent = optionData.text;
        selectElement.appendChild(option);
    }

    selectElement.value = controlState.resolvedActiveProfileName;
}
