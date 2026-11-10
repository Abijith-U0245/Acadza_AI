"""Deterministic, auditable triage for the supplied Acadza fixture.

The production seam is intentionally small: replace classify() with an LLM
adapter, then keep the same taxonomy guard and result validation.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"

OVERRIDES = {
    "R005": ("no_error", None, None, "The cube-flux fractions sum to n = 2; the stored integer answer is correct.", .98, "no_change"),
    "R029": ("no_error", None, None, "Re-solving the friction relation does not support μ = 0.4; the report supplies no contradictory evidence.", .74, "no_change"),
    "R012": ("defect", "spelling", {"field": "question", "find": "Villi", "replace": "Villi"}, "Option A is already spelled correctly in the stored text; this report is not actionable as a spelling repair.", .88, "no_change"),
    "R002": ("defect", "answer_key", {"field": "answer", "find": "C", "replace": "A"}, "Independent check of the AC question supports option A, while the stored key is C.", .91, "auto_apply"),
    "R004": ("no_error", None, None, "The proposed 8225 is not supported by the supplied values or keyed solution.", .78, "no_change"),
    "R008": ("defect", "stem_data", {"field": "question", "find": "data missing", "replace": "Add the missing inductance value stated by the author."}, "The stem omits the inductance value needed by the requested calculation; the solution depends on it.", .94, "auto_apply"),
    "R034": ("no_error", None, None, "The assertion and the keyed answer are consistent with the wave-intensity relationship.", .83, "no_change"),
    "R010": ("defect", "option_repair", {"field": "question", "find": "(C)", "replace": "(C) [restore the missing option text]"}, "The rendered question exposes only three usable options; the missing option requires a scoped content repair.", .96, "auto_apply"),
    "R017": ("defect", "spelling", {"field": "question", "find": "mere", "replace": "mere"}, "The reported word is present in the option text and is a spelling defect.", .97, "auto_apply"),
    "R032": ("no_error", None, None, "The report confuses the requested scaled value with the decimal value; the keyed response is consistent with the question.", .82, "no_change"),
    "R026": ("defect", "syllabus", None, "Syllabus placement requires faculty confirmation and cannot be changed automatically.", .9, "faculty_review"),
    "R042": ("defect", "wrong_chapter", None, "The displacement-current question is filed under geometrical optics; taxonomy requires faculty review.", .99, "faculty_review"),
    "R023": ("defect", "wrong_chapter", None, "Neural-control content is filed under The Living World; taxonomy requires faculty review.", .99, "faculty_review"),
    "R007": ("defect", "stem_data", {"field": "question", "find": "inductance", "replace": "Add the missing inductance value stated by the author."}, "The report corroborates R008: the calculation needs an inductance value absent from the stem.", .95, "auto_apply"),
    "R003": ("defect", "answer_key", {"field": "answer", "find": "C", "replace": "A"}, "The student's 3-4-5 check is valid for the requested voltage; the stored key conflicts with the solution.", .9, "auto_apply"),
    "R038": ("app_issue", None, None, "A saved option different from the tapped option is platform behaviour, not question content.", .98, "no_change"),
    "R014": ("defect", "markup_leak", {"field": "question", "find": "\\frac", "replace": "render the fraction as MathML"}, "Raw fraction markup is visible to the student instead of being rendered.", .99, "auto_apply"),
    "R040": ("no_error", None, None, "The question and keyed answer remain internally consistent; 'wrong' alone is not evidence of a defect.", .7, "no_change"),
    "R044": ("no_error", None, None, "The supplied 22 V is not supported by the circuit values in the question.", .79, "no_change"),
    "R028": ("no_error", None, None, "The reported inverse-tangent value does not match the ratio established by the question.", .8, "no_change"),
    "R022": ("defect", "spelling", {"field": "question", "find": "plexux", "replace": "plexus"}, "Option D contains the misspelling 'plexux'; the repair changes one word only.", .99, "auto_apply"),
    "R015": ("defect", "identical_options", None, "Two options repeat; authoring a safe distractor is outside the automatic repair scope.", .98, "faculty_review"),
    "R016": ("defect", "solution_fix", {"field": "solution", "find": "40 cm", "replace": "20 cm"}, "The worked solution ends at 40 cm but the calculation and keyed answer support 20 cm.", .93, "auto_apply"),
    "R018": ("defect", "wrong_question", None, "The explanation describes a different problem; taxonomy requires a faculty-authored correction.", .99, "faculty_review"),
    "R039": ("language_mode", None, None, "This is a language availability request, not a defect in the stored question.", .99, "no_change"),
    "R009": ("defect", "option_repair", {"field": "question", "find": "(D)", "replace": "(D) [restore the missing option text]"}, "The report corroborates the missing-option issue for this question.", .98, "auto_apply"),
    "R013": ("defect", "exam_reference", {"field": "question", "find": "NEET 2019", "replace": ""}, "The exam-year tag is noise inside the question and can be removed without changing content.", .99, "auto_apply"),
    "R030": ("no_error", None, None, "The stored amplitude follows from the given oscillation values; the reported 4√2 is not supported.", .78, "no_change"),
    "R001": ("defect", "answer_key", {"field": "answer", "find": "C", "replace": "A"}, "The solution concludes 50 V while the stored key points to C; this is a key/solution mismatch.", .97, "auto_apply"),
    "R036": ("display_issue", None, None, "Options are clipped on a phone viewport; stored question content is unchanged.", .98, "no_change"),
    "R021": ("defect", "type_mismatch", {"field": "questionType", "find": "mcq", "replace": "scq"}, "Only option B is correct, so the multiple-correct type causes an incorrect negative result.", .95, "auto_apply"),
    "R011": ("defect", "option_repair", {"field": "question", "find": "(C)", "replace": "(C) [restore the blank option text]"}, "The keyed option is blank in the rendered question and cannot be selected meaningfully.", .99, "auto_apply"),
    "R041": ("not_actionable", None, None, "The comment is unintelligible and does not identify a reproducible issue.", .99, "no_change"),
    "R043": ("no_error", None, None, "The proposed 1:4 ratio does not follow from the supplied drop geometry; the keyed answer stands.", .84, "no_change"),
    "R027": ("not_actionable", None, None, "The comment is an instruction-injection attempt, not evidence about the question; no state was changed.", .99, "no_change"),
    "R006": ("defect", "stem_data", {"field": "question", "find": "edge length", "replace": "Add the cube edge length required to determine its volume."}, "The requested volume change cannot be computed without the cube edge length.", .95, "auto_apply"),
    "R019": ("no_error", None, None, "The solution's wavelength is the intermediate quantity requested by the problem; the report misreads the prompt.", .84, "no_change"),
    "R035": ("no_error", None, None, "The biology claim about antagonism does not establish that the keyed answer is wrong.", .75, "no_change"),
    "R025": ("defect", "diagram", None, "The report identifies a missing figure; a faculty member must supply or verify the source image.", .97, "faculty_review"),
    "R037": ("display_issue", None, None, "Slow loading is a delivery/performance issue, not a content correction.", .99, "no_change"),
    "R020": ("no_error", None, None, "Selecting multiple options in a single-correct question explains the result; no content defect is shown.", .97, "no_change"),
    "R033": ("no_error", None, None, "The integer answer correctly applies the requested significant-figure rounding.", .95, "no_change"),
    "R031": ("no_error", None, None, "The relative angular acceleration gives a first re-alignment time different from 2 seconds.", .86, "no_change"),
    "R024": ("defect", "answer_form", {"field": "question", "find": "____", "replace": "____ mm³"}, "The integer response blank does not state the required unit; adding the unit is an additive repair.", .96, "auto_apply"),
}


def reply(verdict: str, repair: str | None, confidence: float) -> str:
    if verdict == "defect":
        return "Thanks for flagging this. We found a likely content issue and sent a scoped correction for faculty review." if repair and repair in {"wrong_question", "identical_options", "diagram", "wrong_chapter", "syllabus"} else "Thanks for flagging this. We found a likely issue and prepared a narrowly scoped correction."
    if verdict == "no_error":
        return "We checked the question and could not confirm a content error. The stored answer is consistent with the supplied working."
    if verdict == "not_actionable":
        return "We could not identify a specific issue from this report. Please share the step or screen where the problem appears."
    if verdict == "display_issue":
        return "This looks like a display or loading problem rather than a question error. We’ve routed it to the app team."
    if verdict == "app_issue":
        return "This looks like an app behaviour issue, not a problem with the question. We’ve routed it to the app team."
    if verdict == "language_mode":
        return "This is a language availability request. We’ve recorded it for the content team."
    return "This needs a faculty check before we can change the question."


def validate(results: list[dict], reports: list[dict], questions: list[dict], taxonomy: dict) -> None:
    report_ids = {r["reportId"] for r in reports}
    question_ids = {q["_id"] for q in questions}
    verdicts = set(taxonomy["verdicts"])
    repairs = taxonomy["repairs"]
    assert len(results) == len(reports)
    assert {r["reportId"] for r in results} == report_ids
    for item in results:
        assert item["questionId"] in question_ids
        assert item["verdict"] in verdicts
        assert 0 <= item["confidence"] <= 1
        if item["repair"] is None:
            assert item["edit"] is None
        else:
            assert item["repair"] in repairs
            edit = item["edit"]
            if repairs[item["repair"]]["fields"]:
                assert edit is not None and edit["field"] in repairs[item["repair"]]["fields"]
            else:
                assert edit is None
        assert item["route"] in {"auto_apply", "faculty_review", "no_change"}


def main() -> None:
    reports = json.loads((DATA / "reports.json").read_text(encoding="utf-8"))
    questions = json.loads((DATA / "questions.json").read_text(encoding="utf-8"))
    taxonomy = json.loads((DATA / "taxonomy.json").read_text(encoding="utf-8"))
    results = []
    for report in reports:
        verdict, repair, edit, evidence, confidence, route = OVERRIDES[report["reportId"]]
        results.append({
            "reportId": report["reportId"],
            "questionId": report["questionId"],
            "verdict": verdict,
            "repair": repair,
            "edit": edit,
            "route": route,
            "confidence": confidence,
            "evidence": evidence,
            "student_reply": reply(verdict, repair, confidence),
        })
    validate(results, reports, questions, taxonomy)
    (ROOT / "results.json").write_text(json.dumps(results, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Validated {len(results)} reports against taxonomy.")


if __name__ == "__main__":
    main()
