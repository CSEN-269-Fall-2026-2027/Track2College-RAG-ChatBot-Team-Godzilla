"""About you fill: overwrite stale values and force the fixed Yes/No answers."""

from __future__ import annotations

import unittest

from playwright.sync_api import sync_playwright

import uc_sections

# Minimal stand-in for UC's Personal information page: pre-filled with stale answers the
# agent must correct from Track2College facts / fixed rules.
# Field order matches UC: legal name → lived/other name → birthplace → CA public school / SSID.
ABOUT_HTML = """<!doctype html><title>Personal information</title>
<label>Legal first name <input id="first" value="Old"></label>
<label>Last / Family / Surname <input id="last" value="Name"></label>
<fieldset>
  <legend>Do you have a lived name?</legend>
  <label><input type="radio" name="hasLivedName" value="N"> No</label>
  <label><input type="radio" name="hasLivedName" value="Y" checked> Yes</label>
</fieldset>
<fieldset>
  <legend>Have you ever had a different legal name?</legend>
  <label><input type="radio" name="otherNames" value="no"> No</label>
  <label><input type="radio" name="otherNames" value="yes" checked> Yes</label>
</fieldset>
<h2>Where were you born?</h2>
<label>Country <select id="country"><option>Select</option><option selected>United States</option></select></label>
<label>City <input id="city" value="Mountain View"></label>
<fieldset>
  <legend>Have you ever attended a California public school?</legend>
  <label><input type="radio" name="hasAttendedCaPublicSchool" value="N"> No</label>
  <label><input type="radio" name="hasAttendedCaPublicSchool" value="Y" checked> Yes</label>
</fieldset>
<label>CA SSID Number <input id="caStudentId" value="1234567890"></label>
<label><input type="checkbox" id="ssidConsent" name="isAgreeReleaseSsid"> I authorize the release of my CA SSID</label>
"""


class FillAboutYouTest(unittest.TestCase):
    def test_overwrites_stale_fields_and_forces_fixed_nos(self):
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page()
            page.set_content(ABOUT_HTML)
            result = uc_sections.fill_page(
                page,
                uc_sections.ABOUT_YOU_RULES,
                {
                    "first_name": "Darren",
                    "last_name": "Tang",
                    "birth_country": "United States",
                    "birth_city": "Fremont",
                },
                uc_sections.ABOUT_YOU_FIXED,
            )
            self.assertEqual(page.input_value("#city"), "Fremont")
            self.assertEqual(page.input_value("#first"), "Darren")
            self.assertEqual(page.input_value("#last"), "Tang")
            self.assertTrue(page.locator('input[name="hasLivedName"][value="N"]').is_checked())
            self.assertTrue(page.locator('input[name="otherNames"][value="no"]').is_checked())
            self.assertTrue(page.locator('input[name="hasAttendedCaPublicSchool"][value="N"]').is_checked())
            # CA SSID left alone (ignored), not reported as missing.
            self.assertEqual(page.input_value("#caStudentId"), "1234567890")
            self.assertFalse(any("ssid" in m.lower() for m in result["missing"]))
            filled = {f["label"].lower(): f["value"] for f in result["filled"]}
            self.assertEqual(filled.get("city"), "Fremont")
            browser.close()

    def test_leaves_matching_birth_city_alone(self):
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page()
            page.set_content(ABOUT_HTML.replace('value="Mountain View"', 'value="Fremont"'))
            result = uc_sections.fill_page(
                page,
                uc_sections.ABOUT_YOU_RULES,
                {"birth_city": "Fremont", "birth_country": "United States"},
                uc_sections.ABOUT_YOU_FIXED,
            )
            self.assertFalse(any(f["label"].lower() == "city" for f in result["filled"]))
            browser.close()


if __name__ == "__main__":
    unittest.main()
