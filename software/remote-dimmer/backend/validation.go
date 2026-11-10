package main

import (
	"encoding/xml"
	"fmt"
	"os"
	"strconv"
	"strings"
)

const workspaceNS = "http://www.qlcplus.org/Workspace"

type xmlNode struct {
	XMLName  xml.Name
	Attrs    []xml.Attr `xml:",any,attr"`
	Text     string     `xml:",chardata"`
	Children []xmlNode  `xml:",any"`
}

func (n xmlNode) attr(name string) string {
	for _, a := range n.Attrs {
		if a.Name.Space == "" && a.Name.Local == name {
			return a.Value
		}
	}
	return ""
}
func (n *xmlNode) child(name string) *xmlNode {
	for i := range n.Children {
		c := &n.Children[i]
		if c.XMLName.Space == workspaceNS && c.XMLName.Local == name {
			return c
		}
	}
	return nil
}
func (n *xmlNode) text(name string) string {
	if c := n.child(name); c != nil {
		return strings.TrimSpace(c.Text)
	}
	return ""
}
func (n *xmlNode) find(name, id string) *xmlNode {
	if n.XMLName.Space != workspaceNS {
		return nil
	}
	if n.XMLName.Local == name && n.attr("ID") == id {
		return n
	}
	for i := range n.Children {
		if c := n.Children[i].find(name, id); c != nil {
			return c
		}
	}
	return nil
}
func validateProject(c Config) []string {
	warnings := []string{}
	warn := func(format string, args ...any) { warnings = append(warnings, fmt.Sprintf(format, args...)) }
	b, err := os.ReadFile(c.Project)
	if err != nil {
		return []string{fmt.Sprintf("project: %v", err)}
	}
	var root xmlNode
	if err = xml.Unmarshal(b, &root); err != nil {
		return []string{fmt.Sprintf("project XML: %v", err)}
	}
	if root.XMLName != (xml.Name{Space: workspaceNS, Local: "Workspace"}) {
		return []string{"project: expected QLC+ Workspace namespace"}
	}
	vc, engine := root.child("VirtualConsole"), root.child("Engine")
	for _, f := range c.Fixtures {
		warnings = append(warnings, validateMovingPatch(f, engine)...)
		var slider *xmlNode
		if vc != nil {
			slider = vc.find("Slider", strconv.Itoa(f.Slider))
		}
		if slider == nil {
			warn("%s: Slider ID=%d missing under VirtualConsole", f.Name, f.Slider)
			continue
		}
		if slider.text("SliderMode") != "Level" {
			warn("%s: SliderMode must be Level", f.Name)
		}
		if mode := slider.child("SliderMode"); mode != nil {
			for _, a := range mode.Attrs {
				if a.Name.Space == "" && a.Name.Local == "Monitor" && a.Value != "false" {
					warn("%s: channel monitoring must be off for iPhone sliders", f.Name)
				}
			}
		}
		level := slider.child("Level")
		if level == nil {
			warn("%s: Level missing", f.Name)
			continue
		}
		if level.attr("LowLimit") != "0" || level.attr("HighLimit") != "255" {
			warn("%s: Level limits must be 0 and 255", f.Name)
		}
		channels := []xmlNode{}
		for _, ch := range level.Children {
			if ch.XMLName == (xml.Name{Space: workspaceNS, Local: "Channel"}) {
				channels = append(channels, ch)
			}
		}
		if len(channels) != 1 {
			warn("%s: Level must bind exactly one Channel", f.Name)
			continue
		}
		ch := channels[0]
		var fixture *xmlNode
		if engine != nil {
			for i := range engine.Children {
				n := &engine.Children[i]
				if n.XMLName == (xml.Name{Space: workspaceNS, Local: "Fixture"}) && n.text("ID") == ch.attr("Fixture") {
					fixture = n
					break
				}
			}
		}
		if fixture == nil {
			warn("%s: bound Engine Fixture missing", f.Name)
			continue
		}
		universe, uerr := strconv.Atoi(fixture.text("Universe"))
		address, aerr := strconv.Atoi(fixture.text("Address"))
		offset, cerr := strconv.Atoi(strings.TrimSpace(ch.Text))
		if uerr != nil || aerr != nil || cerr != nil || universe < 0 || address < 0 || offset < 0 || universe+1 != f.Universe || address+offset+1 != f.Address {
			warn("%s: bound universe/address does not match config", f.Name)
		}
	}
	var frame *xmlNode
	if vc != nil {
		frame = vc.find("Frame", strconv.Itoa(c.IndicatorFrame))
	}
	if frame == nil {
		warn("indicator: Frame ID=%d missing", c.IndicatorFrame)
	} else {
		pages := frame.child("Multipage")
		if pages == nil || pages.attr("PagesNum") != "2" {
			warn("indicator: Multipage PagesNum must be 2")
		}
		// QLC+ 5 treats the presence of the Multipage attribute as looping on,
		// regardless of its value. Keep accepting the legacy sibling element.
		looping := false
		if pages != nil {
			for _, a := range pages.Attrs {
				if a.Name.Space == "" && a.Name.Local == "PagesLoop" {
					looping = true
				}
			}
		}
		if loop := frame.text("PagesLoop"); looping || (loop != "" && loop != "False") {
			warn("indicator: PagesLoop must be False")
		}
	}
	return warnings
}

func (r *Runtime) checkProject() {
	info, err := os.Stat(r.config.Project)
	var stamp = r.projectStamp
	problem := ""
	if err != nil {
		problem = err.Error()
	} else {
		stamp = info.ModTime()
	}
	if r.projectChecked && stamp.Equal(r.projectStamp) && problem == r.projectError {
		return
	}
	warnings := validateProject(r.config)
	r.mu.Lock()
	defer r.mu.Unlock()
	r.projectChecked, r.projectStamp, r.projectError = true, stamp, problem
	r.warnings = warnings
	for _, warning := range warnings {
		r.event("", "", "validation_warning", 0, "system", fmt.Errorf("%s", warning))
	}
}

// Workspace fixtures carry patch offsets/counts, but their Pan/Tilt groups live
// in an external .qxf definition. Do not pretend a channel name proves a group.
func validateMovingPatch(f Fixture, engine *xmlNode) []string {
	if !f.moving() {
		return nil
	}
	var owner *xmlNode
	for _, ch := range f.axisChannels() {
		var found *xmlNode
		if engine != nil {
			for i := range engine.Children {
				n := &engine.Children[i]
				if n.XMLName != (xml.Name{Space: workspaceNS, Local: "Fixture"}) {
					continue
				}
				u, e1 := strconv.Atoi(n.text("Universe"))
				a, e2 := strconv.Atoi(n.text("Address"))
				count, e3 := strconv.Atoi(n.text("Channels"))
				if e1 == nil && e2 == nil && e3 == nil && absolute(ch) > u*512+a && absolute(ch) <= u*512+a+count {
					if found != nil {
						return []string{fmt.Sprintf("%s: moving channel %d belongs to overlapping project fixtures", f.Name, absolute(ch))}
					}
					found = n
				}
			}
		}
		if found == nil || owner != nil && owner != found {
			return []string{fmt.Sprintf("%s: four Pan/Tilt coarse/fine channels must belong to one Engine Fixture", f.Name)}
		}
		owner = found
	}
	return []string{fmt.Sprintf("%s: Pan/Tilt coarse/fine groups cannot be verified from .qxw; verify fixture %s mode %s against its .qxf definition", f.Name, owner.text("ID"), owner.text("Mode"))}
}
